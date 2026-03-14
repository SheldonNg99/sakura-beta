import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import SessionLocal
import app.models
from app.models.market import Market, MarketStatus
from app.services.resolution_service import resolve_market

logger = logging.getLogger(__name__)


def resolve_due_markets() -> None:
    """
    Finds all BETTING_CLOSED markets past resolution_time and resolves them.
    Runs every 60s via Celery Beat.
    Each market is resolved independently — one failure doesn't block others.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        # Fetch IDs only — resolution_service opens its own lock per market
        market_ids = db.execute(
            select(Market.id).where(
                Market.status == MarketStatus.BETTING_CLOSED,
                Market.resolution_time <= now,
            )
        ).scalars().all()

        if not market_ids:
            return

        logger.info(f"resolve_markets: {len(market_ids)} market(s) due for resolution")

        resolved = 0
        failed = 0
        for market_id in market_ids:
            try:
                success = resolve_market(market_id, db)
                if success:
                    resolved += 1
                else:
                    failed += 1
            except Exception as e:
                failed += 1
                logger.error(f"resolve_markets: market {market_id} failed — {e}", exc_info=True)
                db.rollback()  # reset session state before next market

        logger.info(f"resolve_markets: resolved={resolved}, failed/skipped={failed}")

    except Exception as e:
        db.rollback()
        logger.error(f"resolve_markets: outer error — {e}", exc_info=True)
    finally:
        db.close()