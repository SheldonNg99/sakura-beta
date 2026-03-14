import json
import logging
from decimal import Decimal

import redis
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market import Bet
from app.models.prediction import Prediction, PredictionOutcome
from app.models.user import User
from app.schemas.leaderboard import AIAccuracyResponse, LeaderboardResponse, TopTraderEntry

logger = logging.getLogger(__name__)

CACHE_KEY = "leaderboard:v1"
CACHE_TTL_SECONDS = 60  # recompute at most once per minute

_redis_client: redis.Redis | None = None


def _get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


# ── Compute ────────────────────────────────────────────────────────────────────

def _compute_ai_accuracy(db: Session) -> AIAccuracyResponse:
    """Aggregate prediction outcomes across all resolved predictions."""
    rows = db.execute(
        select(
            Prediction.outcome,
            func.count(Prediction.id).label("count"),
        ).group_by(Prediction.outcome)
    ).all()

    counts = {row.outcome: row.count for row in rows}
    correct   = counts.get(PredictionOutcome.CORRECT, 0)
    incorrect = counts.get(PredictionOutcome.INCORRECT, 0)
    pending   = counts.get(PredictionOutcome.PENDING, 0)
    total     = correct + incorrect  # pending excluded from accuracy

    accuracy_pct = round((correct / total * 100), 1) if total > 0 else 0.0

    return AIAccuracyResponse(
        total_predictions=correct + incorrect + pending,
        correct=correct,
        incorrect=incorrect,
        pending=pending,
        accuracy_pct=accuracy_pct,
    )


def _compute_top_traders(db: Session, limit: int = 10) -> list[TopTraderEntry]:
    """
    Ranks users by total winnings (sum of winning payouts).
    Also computes win rate: winning bets / total resolved bets.
    """
    total_bets_sub = (
        select(Bet.user_id, func.count(Bet.id).label("total_bets"))
        .where(Bet.payout.is_not(None))  # only resolved bets
        .group_by(Bet.user_id)
        .subquery()
    )

    winning_bets_sub = (
        select(
            Bet.user_id,
            func.count(Bet.id).label("winning_bets"),
            func.sum(Bet.payout).label("total_winnings"),
        )
        .where(Bet.payout > 0)
        .group_by(Bet.user_id)
        .subquery()
    )

    rows = db.execute(
        select(
            User.id,
            User.email,
            func.coalesce(winning_bets_sub.c.total_winnings, 0).label("total_winnings"),
            func.coalesce(total_bets_sub.c.total_bets, 0).label("total_bets"),
            func.coalesce(winning_bets_sub.c.winning_bets, 0).label("winning_bets"),
        )
        .outerjoin(winning_bets_sub, User.id == winning_bets_sub.c.user_id)
        .outerjoin(total_bets_sub, User.id == total_bets_sub.c.user_id)
        .where(func.coalesce(total_bets_sub.c.total_bets, 0) > 0)  # exclude users with no bets
        .order_by(func.coalesce(winning_bets_sub.c.total_winnings, 0).desc())
        .limit(limit)
    ).all()

    entries = []
    for rank, row in enumerate(rows, start=1):
        total = row.total_bets or 0
        wins  = row.winning_bets or 0
        win_rate = round((wins / total * 100), 1) if total > 0 else 0.0

        entries.append(TopTraderEntry(
            rank=rank,
            user_id=row.id,
            email=row.email,
            total_winnings=Decimal(str(row.total_winnings)),
            total_bets=total,
            win_rate_pct=win_rate,
        ))

    return entries


def _compute_leaderboard(db: Session) -> LeaderboardResponse:
    return LeaderboardResponse(
        ai_accuracy=_compute_ai_accuracy(db),
        top_traders=_compute_top_traders(db),
    )


# ── Cache layer ────────────────────────────────────────────────────────────────

def get_leaderboard(db: Session) -> LeaderboardResponse:
    """
    Returns leaderboard from Redis cache if fresh.
    Falls back to live DB query if cache is missing or Redis is down.
    """
    try:
        r = _get_redis()
        cached = r.get(CACHE_KEY)
        if cached:
            return LeaderboardResponse.model_validate_json(cached)
    except Exception as e:
        logger.warning(f"leaderboard: Redis read failed, falling back to DB — {e}")

    return _compute_leaderboard(db)


def refresh_leaderboard_cache(db: Session) -> None:
    """
    Recomputes leaderboard and writes it to Redis.
    Called by the scheduled worker — not on every request.
    """
    try:
        leaderboard = _compute_leaderboard(db)
        r = _get_redis()
        r.setex(CACHE_KEY, CACHE_TTL_SECONDS, leaderboard.model_dump_json())
        logger.info("leaderboard: cache refreshed")
    except Exception as e:
        logger.error(f"leaderboard: cache refresh failed — {e}", exc_info=True)