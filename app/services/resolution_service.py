import logging
from decimal import Decimal, ROUND_DOWN

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market import Bet, BetPosition, Market, MarketStatus
from app.models.prediction import Prediction, PredictionOutcome, Direction
from app.services import wallet_service

logger = logging.getLogger(__name__)

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
            logger.warning(f"Price fetch attempt {attempt}/{PRICE_API_MAX_RETRIES} failed for {asset}: {e}")

    raise RuntimeError(f"Failed to fetch price for {asset} after {PRICE_API_MAX_RETRIES} attempts: {last_error}")


# ── Outcome Determination ──────────────────────────────────────────────────────

def determine_outcome(direction: Direction, entry_price: Decimal, exit_price: Decimal) -> PredictionOutcome:
    """
    Compare entry vs exit price against predicted direction.
    Exact match (no movement) counts as incorrect — AI must be right.
    """
    if direction == Direction.UP:
        return PredictionOutcome.CORRECT if exit_price > entry_price else PredictionOutcome.INCORRECT
    else:
        return PredictionOutcome.CORRECT if exit_price < entry_price else PredictionOutcome.INCORRECT


# ── Payout Calculation ─────────────────────────────────────────────────────────

def calculate_payouts(
    winning_bets: list[Bet],
    total_winning_pool: Decimal,
    total_losing_pool: Decimal,
) -> dict[int, Decimal]:
    """
    Proportional payout: winners split the entire pot (winning + losing pool).
    Returns {bet_id: payout_amount}.

    Example: agree pool = 100, disagree pool = 60, total = 160
    A winner who bet 30 out of 100 agree pool gets: (30/100) * 160 = 48
    """
    total_pot = total_winning_pool + total_losing_pool

    if total_winning_pool == Decimal("0") or not winning_bets:
        return {}

    payouts = {}
    for bet in winning_bets:
        share = Decimal(str(bet.amount)) / total_winning_pool
        payout = (share * total_pot).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        payouts[bet.id] = payout

    return payouts


# ── Core Resolution ────────────────────────────────────────────────────────────

def resolve_market(market_id: int, db: Session) -> bool:
    """
    Resolves a single market. Idempotent — safe to retry.
    Returns True if resolved, False if skipped or failed.

    Steps:
      1. Lock market row — prevent double resolution
      2. Validate status is betting_closed
      3. Fetch exit price
      4. Determine outcome
      5. Distribute payouts or refund if no winners
      6. Mark market resolved
    """
    # Step 1: lock market row
    market = db.execute(
        select(Market).where(Market.id == market_id).with_for_update()
    ).scalar_one_or_none()

    if not market:
        logger.error(f"resolve_market: market {market_id} not found")
        return False

    # Step 2: idempotency — only resolve betting_closed markets
    if market.status != MarketStatus.BETTING_CLOSED:
        logger.info(f"resolve_market: skipping market {market_id} — status is {market.status}")
        return False

    prediction = db.get(Prediction, market.prediction_id)
    if not prediction:
        logger.error(f"resolve_market: prediction not found for market {market_id}")
        _mark_stale(market, db)
        return False

    # Step 3: fetch exit price
    try:
        exit_price = fetch_current_price(prediction.asset)
    except RuntimeError as e:
        logger.error(f"resolve_market: price fetch failed for market {market_id}: {e}")
        _mark_stale(market, db)
        db.commit()
        return False

    # Step 4: determine outcome
    entry_price = Decimal(str(prediction.entry_price))
    outcome = determine_outcome(prediction.direction, entry_price, exit_price)

    prediction.outcome = outcome

    # Step 5: distribute payouts
    all_bets: list[Bet] = db.execute(
        select(Bet).where(Bet.market_id == market_id)
    ).scalars().all()

    if not all_bets:
        # No bets placed — nothing to distribute
        logger.info(f"resolve_market: market {market_id} resolved with no bets")
    else:
        winning_position = BetPosition.AGREE if outcome == PredictionOutcome.CORRECT else BetPosition.DISAGREE
        winning_bets = [b for b in all_bets if b.position == winning_position]
        losing_bets  = [b for b in all_bets if b.position != winning_position]

        total_winning_pool = sum((Decimal(str(b.amount)) for b in winning_bets), Decimal("0"))
        total_losing_pool  = sum((Decimal(str(b.amount)) for b in losing_bets),  Decimal("0"))

        if not winning_bets:
            # Everyone loses — refund all bets
            logger.info(f"resolve_market: no winners on market {market_id}, issuing refunds")
            for bet in all_bets:
                wallet_service.refund(
                    user_id=bet.user_id,
                    amount=Decimal(str(bet.amount)),
                    reference_id=market_id,
                    db=db,
                )
                bet.payout = Decimal("0")
        else:
            payouts = calculate_payouts(winning_bets, total_winning_pool, total_losing_pool)
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
    from datetime import datetime, timezone
    market.status = MarketStatus.RESOLVED
    market.resolved_at = datetime.now(timezone.utc)

    db.commit()
    logger.info(f"resolve_market: market {market_id} resolved — outcome={outcome}, exit_price={exit_price}")
    return True


def _mark_stale(market: Market, db: Session) -> None:
    """Marks a market stale when price data is unavailable. Does not commit."""
    logger.warning(f"Marking market {market.id} as stale")
    market.status = MarketStatus.STALE