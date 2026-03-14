import logging
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.prediction import Direction, Prediction, PredictionOutcome
from app.services.resolution_service import fetch_current_price

logger = logging.getLogger(__name__)

# Assets supported at MVP — expand later
SUPPORTED_ASSETS = ["BTC-USD", "ETH-USD"]

# Prediction timeframe in minutes — one value for MVP
DEFAULT_TIMEFRAME_MINUTES = 15


# ── AI Engine ──────────────────────────────────────────────────────────────────

def run_prediction_model(asset: str, entry_price: Decimal) -> tuple[Direction, float]:
    """
    Generates a directional prediction and confidence score for an asset.

    MVP implementation: momentum signal based on recent price history.
    Returns (direction, confidence) where confidence is 0.5–1.0.

    Replace this function body with a real model without touching callers.
    """
    try:
        import numpy as np
        import pandas as pd

        # Fetch recent OHLCV candles from Binance (last 20 x 1min candles)
        symbol = asset.replace("-", "").replace("USD", "USDT").upper()
        response = httpx.get(
            f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1m&limit=20",
            timeout=5,
        )
        response.raise_for_status()
        candles = response.json()

        closes = pd.Series([float(c[4]) for c in candles])  # index 4 = close price

        # Simple momentum: compare last 5 closes vs prior 5 closes
        recent_mean = closes[-5:].mean()
        prior_mean  = closes[-10:-5].mean()
        momentum    = (recent_mean - prior_mean) / prior_mean

        direction  = Direction.UP if momentum >= 0 else Direction.DOWN
        # Confidence: scale magnitude of momentum into 0.5–0.85 range
        confidence = float(min(0.85, 0.5 + abs(momentum) * 100))

        logger.info(f"Prediction for {asset}: {direction} @ {confidence:.2f} confidence (momentum={momentum:.4f})")
        return direction, confidence

    except Exception as e:
        # Fallback to random if data fetch fails — log clearly so we know
        logger.warning(f"Prediction model failed for {asset}, using random fallback: {e}")
        direction  = random.choice([Direction.UP, Direction.DOWN])
        confidence = round(random.uniform(0.50, 0.65), 2)
        return direction, confidence


# ── Generate Prediction + Open Market ─────────────────────────────────────────

def generate_prediction(asset: str, db: Session) -> Prediction:
    """
    Generates a prediction for an asset and persists it.
    Called by the generate_predictions worker on a schedule.
    Caller is responsible for opening the market via market_service.
    """
    if asset not in SUPPORTED_ASSETS:
        raise ValueError(f"Unsupported asset: {asset}. Supported: {SUPPORTED_ASSETS}")

    entry_price = fetch_current_price(asset)
    direction, confidence = run_prediction_model(asset, entry_price)

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
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)

    logger.info(f"Generated prediction {prediction.id}: {asset} {direction} @ {entry_price}")
    return prediction


# ── Queries ────────────────────────────────────────────────────────────────────

def get_latest_predictions(
    db: Session,
    limit: int = 10,
    asset: str | None = None,
) -> list[Prediction]:
    """Returns most recent predictions, optionally filtered by asset."""
    query = select(Prediction).order_by(Prediction.generated_at.desc()).limit(limit)
    if asset:
        query = query.where(Prediction.asset == asset)
    return db.execute(query).scalars().all()


def get_prediction_by_id(prediction_id: int, db: Session) -> Prediction | None:
    return db.get(Prediction, prediction_id)