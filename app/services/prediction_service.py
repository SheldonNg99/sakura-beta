# app/services/prediction_service.py
import logging
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.agent import Agent
from app.models.prediction import Direction, Prediction, PredictionOutcome
from app.services.resolution_service import fetch_current_price

logger = logging.getLogger(__name__)

# Assets the system runs predictions on
SUPPORTED_ASSETS = ["BTC-USD", "ETH-USD"]

# Prediction timeframe in minutes
DEFAULT_TIMEFRAME_MINUTES = 15


# ── Candle Fetching ────────────────────────────────────────────────────────────

def fetch_candles(asset: str, limit: int = 20) -> list[dict]:
    """
    Fetches recent 1-minute OHLCV candles from Binance.
    Returns a list of dicts in the shape agents expect:
        {"open": float, "high": float, "low": float, "close": float, "volume": float}

    Falls back to empty list on failure — callers must handle gracefully.
    """
    symbol = asset.replace("-", "").replace("USD", "USDT").upper()
    try:
        response = httpx.get(
            f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1m&limit={limit}",
            timeout=5,
        )
        response.raise_for_status()
        raw = response.json()
        return [
            {
                "open":   float(c[1]),
                "high":   float(c[2]),
                "low":    float(c[3]),
                "close":  float(c[4]),
                "volume": float(c[5]),
            }
            for c in raw
        ]
    except Exception as exc:
        logger.warning(f"fetch_candles: failed for {asset} — {exc}")
        return []


# ── System Prediction Model (fallback / no-agent markets) ─────────────────────

def _run_system_model(asset: str, entry_price: Decimal) -> tuple[Direction, float]:
    """
    Built-in momentum model — used when no agent is specified.
    Kept isolated so it's easy to swap out without touching callers.
    """
    try:
        import numpy as np
        import pandas as pd

        candles = fetch_candles(asset, limit=20)
        if len(candles) < 10:
            raise ValueError("Not enough candles for momentum signal")

        closes = pd.Series([c["close"] for c in candles])
        recent_mean = closes[-5:].mean()
        prior_mean  = closes[-10:-5].mean()
        momentum    = (recent_mean - prior_mean) / prior_mean

        direction  = Direction.UP if momentum >= 0 else Direction.DOWN
        confidence = float(min(0.85, 0.5 + abs(momentum) * 100))

        logger.info(
            f"system model {asset}: {direction} @ {confidence:.2f} "
            f"(momentum={momentum:.4f})"
        )
        return direction, confidence

    except Exception as exc:
        logger.warning(f"system model failed for {asset}, using random fallback: {exc}")
        return (
            random.choice([Direction.UP, Direction.DOWN]),
            round(random.uniform(0.50, 0.65), 2),
        )


# ── Agent Prediction ───────────────────────────────────────────────────────────

def _run_agent_model(
    agent: Agent,
    asset: str,
    entry_price: Decimal,
) -> tuple[Direction, float]:
    """
    Runs the user's uploaded agent script inside the sandbox.
    Falls back to the system model if the agent errors or times out.
    """
    from app.services.agent_sandbox import AgentExecutionError, run_agent

    candles = fetch_candles(asset, limit=20)

    try:
        direction_str, confidence = run_agent(
            code=agent.code,
            asset=asset,
            price=entry_price,
            candles=candles,
        )
        direction = Direction.UP if direction_str == "up" else Direction.DOWN
        logger.info(
            f"agent {agent.id} ({agent.name}) {asset}: "
            f"{direction} @ {confidence:.2f}"
        )
        return direction, confidence

    except AgentExecutionError as exc:
        logger.warning(
            f"agent {agent.id} ({agent.name}) failed for {asset} — "
            f"{exc}. Falling back to system model."
        )
        return _run_system_model(asset, entry_price)


# ── Public: Generate Prediction ────────────────────────────────────────────────

def generate_prediction(asset: str, db: Session) -> Prediction:
    """
    Generates a system prediction (no agent) for an asset and persists it.
    Backward-compatible — used by the dev seed endpoint and as a fallback.
    """
    if asset not in SUPPORTED_ASSETS:
        raise ValueError(f"Unsupported asset: {asset}. Supported: {SUPPORTED_ASSETS}")

    entry_price = fetch_current_price(asset)
    direction, confidence = _run_system_model(asset, entry_price)

    return _persist_prediction(
        asset=asset,
        direction=direction,
        confidence=confidence,
        entry_price=entry_price,
        agent_id=None,
        db=db,
    )


def generate_prediction_for_agent(
    agent: Agent,
    asset: str,
    db: Session,
) -> Prediction:
    """
    Runs `agent` on `asset` inside the sandbox and persists the resulting prediction.
    Called by the generate_predictions worker for each active agent × asset pair.
    """
    if asset not in SUPPORTED_ASSETS:
        raise ValueError(f"Unsupported asset: {asset}. Supported: {SUPPORTED_ASSETS}")

    entry_price = fetch_current_price(asset)
    direction, confidence = _run_agent_model(agent, asset, entry_price)

    return _persist_prediction(
        asset=asset,
        direction=direction,
        confidence=confidence,
        entry_price=entry_price,
        agent_id=agent.id,
        db=db,
    )


def _persist_prediction(
    asset: str,
    direction: Direction,
    confidence: float,
    entry_price: Decimal,
    agent_id: int | None,
    db: Session,
) -> Prediction:
    now = datetime.now(timezone.utc)
    prediction = Prediction(
        asset=asset,
        direction=direction,
        confidence=confidence,
        entry_price=entry_price,
        timeframe_minutes=DEFAULT_TIMEFRAME_MINUTES,
        outcome=PredictionOutcome.PENDING,
        generated_at=now,
        expires_at=now + timedelta(minutes=DEFAULT_TIMEFRAME_MINUTES),
        agent_id=agent_id,
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)

    label = f"agent_id={agent_id}" if agent_id else "system"
    logger.info(
        f"persisted prediction {prediction.id}: "
        f"{asset} {direction} @ {entry_price} [{label}]"
    )
    return prediction


# ── Queries ────────────────────────────────────────────────────────────────────

def get_latest_predictions(
    db: Session,
    limit: int = 10,
    asset: str | None = None,
) -> list[Prediction]:
    query = select(Prediction).order_by(Prediction.generated_at.desc()).limit(limit)
    if asset:
        query = query.where(Prediction.asset == asset)
    return db.execute(query).scalars().all()


def get_prediction_by_id(prediction_id: int, db: Session) -> Prediction | None:
    return db.get(Prediction, prediction_id)