# app/schemas/market.py
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.models.market import BetPosition, MarketStatus
from app.models.prediction import Direction, PredictionOutcome


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

    # Enriched prediction fields
    asset: str
    direction: Direction
    confidence: float
    entry_price: Decimal
    outcome: PredictionOutcome

    # Agent attribution
    agent_id: int | None
    agent_name: str | None

    # On-chain market ID — null until synced
    onchain_market_id: int | None = None

    model_config = {"from_attributes": False}


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