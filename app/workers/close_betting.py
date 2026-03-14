import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import SessionLocal
import app.models
from app.models.market import Market, MarketStatus

logger = logging.getLogger(__name__)


def close_expired_betting_windows() -> None:
    """
    Flips all OPEN markets past betting_closes_at → BETTING_CLOSED.
    Runs every 30s via Celery Beat.
    """
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)

        markets = db.execute(
            select(Market).where(
                Market.status == MarketStatus.OPEN,
                Market.betting_closes_at <= now,
            ).with_for_update(skip_locked=True)  # skip rows locked by concurrent runs
        ).scalars().all()

        if not markets:
            return

        for market in markets:
            market.status = MarketStatus.BETTING_CLOSED
            logger.info(f"close_betting: market {market.id} → BETTING_CLOSED")

        db.commit()
        logger.info(f"close_betting: closed {len(markets)} market(s)")

    except Exception as e:
        db.rollback()
        logger.error(f"close_betting: error — {e}", exc_info=True)
    finally:
        db.close()