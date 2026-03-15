# app/services/resolution_service.py
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.agent import Agent
from app.models.market import Bet, BetPosition, Market, MarketStatus
from app.models.prediction import Prediction, PredictionOutcome, Direction
from app.models.user import User
from app.services import wallet_service

logger = logging.getLogger(__name__)

# ── Fee config ─────────────────────────────────────────────────────────────────

# Only paid when agent prediction is CORRECT
CREATOR_FEE_PCT  = Decimal("0.05")   # 5% to agent creator
PLATFORM_FEE_PCT = Decimal("0.02")   # 2% to platform (PLATFORM_FEE_USER_ID)

# Price fetch config
PRICE_API_TIMEOUT_SECONDS = 5
PRICE_API_MAX_RETRIES = 3


# ── Price Fetching ─────────────────────────────────────────────────────────────

def fetch_current_price(asset: str) -> Decimal:
    """
    Fetch current price from Binance public API.
    Retries up to PRICE_API_MAX_RETRIES times before raising.
    asset format: "BTC-USD" → converted to "BTCUSDT" for Binance.
    """
    symbol = asset.replace("-", "").replace("USD", "USDT").upper()
    url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}"

    last_error = None
    for attempt in range(1, PRICE_API_MAX_RETRIES + 1):
        try:
            response = httpx.get(url, timeout=PRICE_API_TIMEOUT_SECONDS)
            response.raise_for_status()
            data = response.json()
            return Decimal(data["price"])
        except Exception as e:
            last_error = e
            logger.warning(
                f"Price fetch attempt {attempt}/{PRICE_API_MAX_RETRIES} "
                f"failed for {asset}: {e}"
            )

    raise RuntimeError(
        f"Failed to fetch price for {asset} after "
        f"{PRICE_API_MAX_RETRIES} attempts: {last_error}"
    )


# ── Outcome Determination ──────────────────────────────────────────────────────

def determine_outcome(
    direction: Direction,
    entry_price: Decimal,
    exit_price: Decimal,
) -> PredictionOutcome:
    """
    Exact match (no movement) counts as incorrect — agent must be right.
    """
    if direction == Direction.UP:
        return PredictionOutcome.CORRECT if exit_price > entry_price else PredictionOutcome.INCORRECT
    else:
        return PredictionOutcome.CORRECT if exit_price < entry_price else PredictionOutcome.INCORRECT


# ── Fee Distribution ───────────────────────────────────────────────────────────

def _distribute_fees(
    total_pool: Decimal,
    agent: Agent | None,
    market_id: int,
    db: Session,
) -> Decimal:
    """
    Deducts creator (5%) and platform (2%) fees from the total pool.
    Only called when the agent prediction is CORRECT.

    Returns the distributable amount remaining after fees.
    """
    distributable = total_pool

    # ── Platform fee (2%) → PLATFORM_FEE_USER_ID ──────────────────────────────
    platform_user_id_str = os.getenv("PLATFORM_FEE_USER_ID")
    if platform_user_id_str:
        try:
            platform_user_id = int(platform_user_id_str)
            platform_fee = (total_pool * PLATFORM_FEE_PCT).quantize(
                Decimal("0.01"), rounding=ROUND_DOWN
            )
            if platform_fee > Decimal("0"):
                wallet_service.credit(
                    user_id=platform_user_id,
                    amount=platform_fee,
                    reference_id=market_id,
                    db=db,
                )
                distributable -= platform_fee
                logger.info(
                    f"resolve_market: platform fee {platform_fee} "
                    f"→ user {platform_user_id} (market {market_id})"
                )
        except (ValueError, TypeError) as e:
            logger.warning(f"resolve_market: invalid PLATFORM_FEE_USER_ID — {e}")
    else:
        logger.debug(
            "resolve_market: PLATFORM_FEE_USER_ID not set, skipping platform fee"
        )

    # ── Creator fee (5%) → agent uploader ─────────────────────────────────────
    if agent is not None:
        creator_fee = (total_pool * CREATOR_FEE_PCT).quantize(
            Decimal("0.01"), rounding=ROUND_DOWN
        )
        if creator_fee > Decimal("0"):
            wallet_service.credit(
                user_id=agent.user_id,
                amount=creator_fee,
                reference_id=market_id,
                db=db,
            )
            distributable -= creator_fee
            logger.info(
                f"resolve_market: creator fee {creator_fee} "
                f"→ user {agent.user_id} (agent '{agent.name}', market {market_id})"
            )
    else:
        logger.debug(
            f"resolve_market: market {market_id} has no agent, skipping creator fee"
        )

    return distributable


# ── Payout Calculation ─────────────────────────────────────────────────────────

def calculate_payouts(
    winning_bets: list[Bet],
    total_winning_pool: Decimal,
    distributable: Decimal,
) -> dict[int, Decimal]:
    """
    Proportional payout from the distributable pool (after fees).
    Returns {bet_id: payout_amount}.
    """
    if total_winning_pool == Decimal("0") or not winning_bets:
        return {}

    payouts = {}
    for bet in winning_bets:
        share = Decimal(str(bet.amount)) / total_winning_pool
        payout = (share * distributable).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        payouts[bet.id] = payout

    return payouts


# ── Core Resolution ────────────────────────────────────────────────────────────

def resolve_market(market_id: int, db: Session) -> bool:
    """
    Resolves a single market. Idempotent — safe to retry.
    Returns True if resolved, False if skipped or failed.

    Fee flow (only when agent is CORRECT):
      Total pool
        - 2% platform fee  → PLATFORM_FEE_USER_ID wallet
        - 5% creator fee   → agent uploader's wallet
        = distributable    → split proportionally among winning bettors

    If agent is INCORRECT or no agent:
      - No fees deducted
      - Winners split full pool
    """
    # Step 1: lock market row
    market = db.execute(
        select(Market).where(Market.id == market_id).with_for_update()
    ).scalar_one_or_none()

    if not market:
        logger.error(f"resolve_market: market {market_id} not found")
        return False

    # Step 2: idempotency
    if market.status != MarketStatus.BETTING_CLOSED:
        logger.info(
            f"resolve_market: skipping market {market_id} "
            f"— status is {market.status}"
        )
        return False

    # Load prediction + agent in one go
    prediction = db.execute(
        select(Prediction)
        .options(joinedload(Prediction.agent))
        .where(Prediction.id == market.prediction_id)
    ).scalar_one_or_none()

    if not prediction:
        logger.error(
            f"resolve_market: prediction not found for market {market_id}"
        )
        _mark_stale(market, db)
        return False

    agent: Agent | None = prediction.agent

    # Step 3: fetch exit price
    try:
        exit_price = fetch_current_price(prediction.asset)
    except RuntimeError as e:
        logger.error(
            f"resolve_market: price fetch failed for market {market_id}: {e}"
        )
        _mark_stale(market, db)
        db.commit()
        return False

    # Step 4: determine outcome
    entry_price = Decimal(str(prediction.entry_price))
    outcome = determine_outcome(prediction.direction, entry_price, exit_price)
    prediction.outcome = outcome

    # Step 5: distribute fees + payouts
    all_bets: list[Bet] = db.execute(
        select(Bet).where(Bet.market_id == market_id)
    ).scalars().all()

    if not all_bets:
        logger.info(f"resolve_market: market {market_id} resolved with no bets")
    else:
        total_pool = sum(
            (Decimal(str(b.amount)) for b in all_bets), Decimal("0")
        )
        winning_position = (
            BetPosition.AGREE if outcome == PredictionOutcome.CORRECT
            else BetPosition.DISAGREE
        )
        winning_bets = [b for b in all_bets if b.position == winning_position]
        losing_bets  = [b for b in all_bets if b.position != winning_position]
        total_winning_pool = sum(
            (Decimal(str(b.amount)) for b in winning_bets), Decimal("0")
        )

        if not winning_bets:
            # Everyone on the same side — refund all
            logger.info(
                f"resolve_market: no winners on market {market_id}, issuing refunds"
            )
            for bet in all_bets:
                wallet_service.refund(
                    user_id=bet.user_id,
                    amount=Decimal(str(bet.amount)),
                    reference_id=market_id,
                    db=db,
                )
                bet.payout = Decimal("0")
        else:
            # Deduct fees only when agent was CORRECT
            if outcome == PredictionOutcome.CORRECT:
                distributable = _distribute_fees(
                    total_pool=total_pool,
                    agent=agent,
                    market_id=market_id,
                    db=db,
                )
            else:
                # Agent wrong → no creator/platform fee, winners get full pool
                distributable = total_pool

            payouts = calculate_payouts(winning_bets, total_winning_pool, distributable)
            for bet in winning_bets:
                payout = payouts.get(bet.id, Decimal("0"))
                bet.payout = payout
                if payout > Decimal("0"):
                    wallet_service.credit(
                        user_id=bet.user_id,
                        amount=payout,
                        reference_id=market_id,
                        db=db,
                    )
            for bet in losing_bets:
                bet.payout = Decimal("0")

    # Step 6: mark resolved
    market.status = MarketStatus.RESOLVED
    market.resolved_at = datetime.now(timezone.utc)

    db.commit()
    logger.info(
        f"resolve_market: market {market_id} resolved — "
        f"outcome={outcome}, exit_price={exit_price}"
    )
    return True


def _mark_stale(market: Market, db: Session) -> None:
    """Marks a market stale when price data is unavailable. Does not commit."""
    logger.warning(f"Marking market {market.id} as stale")
    market.status = MarketStatus.STALE