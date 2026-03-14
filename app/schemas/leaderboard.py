# app/schemas/leaderboard.py
from decimal import Decimal

from pydantic import BaseModel


class AIAccuracyResponse(BaseModel):
    total_predictions: int
    correct: int
    incorrect: int
    pending: int
    accuracy_pct: float  # 0.0 - 100.0


class TopTraderEntry(BaseModel):
    rank: int
    user_id: int
    email: str
    total_winnings: Decimal
    total_bets: int
    win_rate_pct: float


class LeaderboardResponse(BaseModel):
    ai_accuracy: AIAccuracyResponse
    top_traders: list[TopTraderEntry]