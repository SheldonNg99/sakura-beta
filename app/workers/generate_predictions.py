import logging

from sqlalchemy import select

from app.core.database import SessionLocal
import app.models
from app.models.market import Market, MarketStatus
from app.models.prediction import Prediction
from app.services import market_service, prediction_service

logger = logging.getLogger(__name__)


def generate_predictions_for_all_assets() -> None:
    """
    Generates a new prediction + opens a market for each supported asset,
    but only if that asset has no currently open market.
    Runs every 15 minutes via Celery Beat.
    """
    db = SessionLocal()
    try:
        for asset in prediction_service.SUPPORTED_ASSETS:
            try:
                _generate_for_asset(asset, db)
            except Exception as e:
                logger.error(f"generate_predictions: failed for {asset} — {e}", exc_info=True)
                db.rollback()
    finally:
        db.close()


def _generate_for_asset(asset: str, db: SessionLocal) -> None:
    # Skip if an open market already exists for this asset
    existing_open = db.execute(
        select(Market)
        .join(Prediction, Market.prediction_id == Prediction.id)
        .where(
            Prediction.asset == asset,
            Market.status == MarketStatus.OPEN,
        )
    ).scalar_one_or_none()

    if existing_open:
        logger.info(f"generate_predictions: skipping {asset} — open market already exists")
        return

    prediction = prediction_service.generate_prediction(asset, db)
    market = market_service.create_market(prediction, db)
    logger.info(f"generate_predictions: created prediction {prediction.id} + market {market.id} for {asset}")