from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.market import BetPosition, MarketStatus


class MarketResponse(BaseModel):
    id: int
    prediction_id: int
    status: MarketStatus
    total_agree_pool: Decimal
    total_disagree_pool: Decimal
    opened_at: datetime
    betting_closes_at: datetime
    prediction_target_time: datetime
    resolution_time: datetime

    model_config = {"from_attributes": True}


class PlaceBetRequest(BaseModel):
    position: BetPosition
    amount: Decimal


class BetResponse(BaseModel):
    id: int
    market_id: int
    user_id: int
    position: BetPosition
    amount: Decimal
    payout: Decimal | None
    placed_at: datetime

    model_config = {"from_attributes": True}