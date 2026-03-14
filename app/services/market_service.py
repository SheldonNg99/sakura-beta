from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market import Bet, BetPosition, Market, MarketStatus
from app.models.prediction import Prediction
from app.services import wallet_service

# Timing constants (seconds) — matches architecture decision
BETTING_CLOSE_BUFFER_SECONDS = 60   # close betting 60s before target
RESOLUTION_BUFFER_SECONDS = 60      # resolve 60s after target


def create_market(prediction: Prediction, db: Session) -> Market:
    """
    Opens a market for a given prediction.
    Timing: open → betting_closes_at → prediction_target_time → resolution_time
    """
    # Guard: don't create duplicate markets for the same prediction
    existing = db.execute(
        select(Market).where(Market.prediction_id == prediction.id)
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Market already exists for prediction {prediction.id}",
        )

    now = datetime.now(timezone.utc)
    prediction_target_time = now + timedelta(minutes=prediction.timeframe_minutes)
    betting_closes_at = prediction_target_time - timedelta(seconds=BETTING_CLOSE_BUFFER_SECONDS)
    resolution_time = prediction_target_time + timedelta(seconds=RESOLUTION_BUFFER_SECONDS)

    # Sanity check: betting window must be open
    if betting_closes_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Prediction timeframe too short to open a betting window",
        )

    market = Market(
        prediction_id=prediction.id,
        status=MarketStatus.OPEN,
        betting_closes_at=betting_closes_at,
        prediction_target_time=prediction_target_time,
        resolution_time=resolution_time,
    )
    db.add(market)
    db.commit()
    db.refresh(market)
    return market


def place_bet(
    user_id: int,
    market_id: int,
    position: BetPosition,
    amount: Decimal,
    db: Session,
) -> Bet:
    """
    Place a bet on a market.

    Steps (all in one transaction):
      1. Lock the market row to prevent concurrent pool updates
      2. Validate market is still open
      3. Debit user wallet
      4. Write bet record
      5. Update pool totals
    """
    # Step 1: lock market row — prevents race on pool totals
    market = db.execute(
        select(Market).where(Market.id == market_id).with_for_update()
    ).scalar_one_or_none()

    if not market:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Market not found",
        )

    # Step 2: validate market is still accepting bets
    now = datetime.now(timezone.utc)

    if market.status != MarketStatus.OPEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Market is not open for betting (status: {market.status})",
        )

    if now >= market.betting_closes_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Betting window has closed for this market",
        )

    # Step 3: debit wallet (raises 400 if insufficient balance)
    # Pass market_id as reference so the transaction is traceable
    wallet_service.debit(
        user_id=user_id,
        amount=amount,
        reference_id=market_id,
        db=db,
    )

    # Step 4: write bet record
    bet = Bet(
        user_id=user_id,
        market_id=market_id,
        position=position,
        amount=amount,
        payout=None,  # populated by resolution worker
    )
    db.add(bet)

    # Step 5: update pool totals
    if position == BetPosition.AGREE:
        market.total_agree_pool = Decimal(str(market.total_agree_pool)) + amount
    else:
        market.total_disagree_pool = Decimal(str(market.total_disagree_pool)) + amount

    db.commit()
    db.refresh(bet)
    return bet


def get_open_markets(db: Session, limit: int = 20, offset: int = 0) -> list[Market]:
    """Returns currently open markets ordered by soonest closing."""
    return db.execute(
        select(Market)
        .where(Market.status == MarketStatus.OPEN)
        .order_by(Market.betting_closes_at.asc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()


def get_market_by_id(market_id: int, db: Session) -> Market:
    market = db.get(Market, market_id)
    if not market:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Market not found",
        )
    return market