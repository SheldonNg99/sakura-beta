# app/workers/generate_predictions.py
"""
Prediction generation worker.

Strategy:
  For every active agent × every supported asset:
    - Skip if an open market already exists for that (agent, asset) pair
    - Run the agent in the sandbox
    - Open a new market for the resulting prediction

  Also runs the built-in system model for any asset that has no agent coverage,
  ensuring markets are always available even before users upload agents.

Runs every 15 minutes via Celery Beat.
"""
import logging

from sqlalchemy import select

from app.core.database import SessionLocal
import app.models  # noqa: F401 — ensures all models are registered with SQLAlchemy
from app.models.agent import Agent
from app.models.market import Market, MarketStatus
from app.models.prediction import Prediction
from app.services import agent_service, market_service, prediction_service

logger = logging.getLogger(__name__)


def generate_predictions_for_all_agents() -> None:
    """
    Entry point called by the Celery task.

    Iterates active agents × supported assets, then fills any asset gaps
    with system-model predictions so the markets page is never empty.
    """
    db = SessionLocal()
    try:
        active_agents = agent_service.get_all_active_agents(db)

        # Track which assets already got an agent-driven market this cycle
        assets_covered: set[str] = set()

        for agent in active_agents:
            for asset in prediction_service.SUPPORTED_ASSETS:
                try:
                    opened = _generate_for_agent_asset(agent, asset, db)
                    if opened:
                        assets_covered.add(asset)
                except Exception as exc:
                    logger.error(
                        f"generate_predictions: agent {agent.id} ({agent.name}) "
                        f"/ {asset} failed — {exc}",
                        exc_info=True,
                    )
                    db.rollback()

        # Fill assets that no active agent covered with the system model
        for asset in prediction_service.SUPPORTED_ASSETS:
            if asset in assets_covered:
                continue
            try:
                _generate_system_fallback(asset, db)
            except Exception as exc:
                logger.error(
                    f"generate_predictions: system fallback for {asset} failed — {exc}",
                    exc_info=True,
                )
                db.rollback()

    finally:
        db.close()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _generate_for_agent_asset(agent: Agent, asset: str, db: SessionLocal) -> bool:
    """
    Generates a prediction + market for one (agent, asset) pair.
    Returns True if a new market was opened, False if skipped.

    Skip condition: an OPEN or BETTING_CLOSED market exists for this agent + asset.
    — OPEN: betting in progress, don't open a duplicate
    — BETTING_CLOSED: awaiting resolution, still in-flight
    Auto-reopens after RESOLVED or STALE — the market lifecycle is complete.
    """
    in_flight = db.execute(
        select(Market)
        .join(Prediction, Market.prediction_id == Prediction.id)
        .where(
            Prediction.agent_id == agent.id,
            Prediction.asset == asset,
            Market.status.in_([MarketStatus.OPEN, MarketStatus.BETTING_CLOSED]),
        )
    ).scalar_one_or_none()

    if in_flight:
        logger.info(
            f"generate_predictions: skipping agent {agent.id} / {asset} "
            f"— market {in_flight.id} is {in_flight.status}"
        )
        return False

    prediction = prediction_service.generate_prediction_for_agent(agent, asset, db)
    market = market_service.create_market(prediction, db)

    logger.info(
        f"generate_predictions: agent {agent.id} ({agent.name}) / {asset} "
        f"→ prediction {prediction.id} + market {market.id}"
    )
    return True


def _generate_system_fallback(asset: str, db: SessionLocal) -> None:
    """
    Runs the built-in system model for an asset when no active agent
    has produced a market for it this cycle.

    Skip condition: any OPEN or BETTING_CLOSED market exists for this asset.
    Reopens after RESOLVED or STALE.
    """
    in_flight = db.execute(
        select(Market)
        .join(Prediction, Market.prediction_id == Prediction.id)
        .where(
            Prediction.asset == asset,
            Market.status.in_([MarketStatus.OPEN, MarketStatus.BETTING_CLOSED]),
        )
    ).scalar_one_or_none()

    if in_flight:
        logger.info(
            f"generate_predictions: system fallback skipping {asset} "
            f"— market {in_flight.id} is {in_flight.status}"
        )
        return

    prediction = prediction_service.generate_prediction(asset, db)
    market = market_service.create_market(prediction, db)

    logger.info(
        f"generate_predictions: system fallback {asset} "
        f"→ prediction {prediction.id} + market {market.id}"
    )


# ── Legacy alias (keeps old task name working without celery restart) ──────────

def generate_predictions_for_all_assets() -> None:
    """Alias kept for backward compatibility with the Celery task name."""
    generate_predictions_for_all_agents()