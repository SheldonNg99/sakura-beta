from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.prediction import Direction, PredictionOutcome


class PredictionResponse(BaseModel):
    id: int
    asset: str
    direction: Direction
    confidence: float
    entry_price: Decimal
    timeframe_minutes: int
    outcome: PredictionOutcome
    generated_at: datetime
    expires_at: datetime
    resolved_at: datetime | None

    model_config = {"from_attributes": True}