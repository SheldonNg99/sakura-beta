# app/services/market_service.py
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.agent import Agent
from app.models.market import Bet, BetPosition, Market, MarketStatus
from app.models.prediction import Prediction
from app.schemas.market import MarketResponse
from app.services import wallet_service

# Timing constants (seconds)
BETTING_CLOSE_BUFFER_SECONDS = 60
RESOLUTION_BUFFER_SECONDS = 80


# ── Response builder ───────────────────────────────────────────────────────────

def _build_response(market: Market, prediction: Prediction, agent: Agent | None) -> MarketResponse:
    return MarketResponse(
        id=market.id,
        prediction_id=market.prediction_id,
        status=market.status,
        total_agree_pool=Decimal(str(market.total_agree_pool)),
        total_disagree_pool=Decimal(str(market.total_disagree_pool)),
        opened_at=market.opened_at,
        betting_closes_at=market.betting_closes_at,
        prediction_target_time=market.prediction_target_time,
        resolution_time=market.resolution_time,
        asset=prediction.asset,
        direction=prediction.direction,
        confidence=prediction.confidence,
        entry_price=Decimal(str(prediction.entry_price)),
        outcome=prediction.outcome,
        agent_id=agent.id if agent else None,
        agent_name=agent.name if agent else None,
        onchain_market_id=market.onchain_market_id,
    )


# ── Create ─────────────────────────────────────────────────────────────────────

def create_market(prediction: Prediction, db: Session) -> Market:
    """
    Opens a market for a given prediction.
    After saving to DB, attempts to register the market on-chain.
    On-chain call is best-effort — failure does not block market creation.
    """
    existing = db.execute(
        select(Market).where(Market.prediction_id == prediction.id)
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Market already exists for prediction {prediction.id}",
        )

    # Override timeframe for longer betting windows
    now = datetime.now(timezone.utc)
    betting_window_minutes = 5
    prediction_target_time = now + timedelta(minutes=betting_window_minutes)
    betting_closes_at = prediction_target_time - timedelta(seconds=BETTING_CLOSE_BUFFER_SECONDS)
    resolution_time = prediction_target_time + timedelta(seconds=RESOLUTION_BUFFER_SECONDS)

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

    # ── Sync to Clarity contract (best-effort) ─────────────────────────────────
    # We estimate the target Stacks block from the resolution time.
    # Stacks produces ~1 block every 10 seconds on average.
    try:
        from app.services.stacks_client import create_market_onchain

        seconds_until_target = (prediction_target_time - now).total_seconds()
        estimated_blocks = max(1, int(seconds_until_target / 10))

        # Use current block height + estimated blocks as target
        # In practice fetch current block from Stacks API; here we use a safe estimate
        target_block = estimated_blocks

        onchain_id = create_market_onchain(
            db_market_id=market.id,
            agent_id=prediction.agent_id or 0,  # 0 for system agent
            asset=prediction.asset,
            direction=prediction.direction.value,
            entry_price_usd=float(prediction.entry_price),
            prediction_id=prediction.id,
            confidence=prediction.confidence,
            target_block=target_block,
        )

        if onchain_id is not None:
            market.onchain_market_id = onchain_id
            db.commit()

    except Exception as exc:
        # Non-fatal — DB market is already created
        import logging
        logging.getLogger(__name__).error(
            f"market_service: on-chain sync failed for market {market.id} — {exc}"
        )

    return market


# ── Queries ────────────────────────────────────────────────────────────────────

def get_open_markets(db: Session, limit: int = 20, offset: int = 0) -> list[MarketResponse]:
    rows = db.execute(
        select(Market)
        .options(joinedload(Market.prediction).joinedload(Prediction.agent))
        .where(Market.status == MarketStatus.OPEN)
        .order_by(Market.betting_closes_at.asc())
        .limit(limit)
        .offset(offset)
    ).scalars().unique().all()

    return [_build_response(m, m.prediction, m.prediction.agent) for m in rows]


def get_market_by_id(market_id: int, db: Session) -> MarketResponse:
    market = db.execute(
        select(Market)
        .options(joinedload(Market.prediction).joinedload(Prediction.agent))
        .where(Market.id == market_id)
    ).scalar_one_or_none()

    if not market:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Market not found",
        )

    return _build_response(market, market.prediction, market.prediction.agent)


# ── Bet ────────────────────────────────────────────────────────────────────────

def place_bet(
    user_id: int,
    market_id: int,
    position: BetPosition,
    amount: Decimal,
    db: Session,
) -> Bet:
    market = db.execute(
        select(Market).where(Market.id == market_id).with_for_update()
    ).scalar_one_or_none()

    if not market:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Market not found")

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

    wallet_service.debit(user_id=user_id, amount=amount, reference_id=market_id, db=db)

    bet = Bet(user_id=user_id, market_id=market_id, position=position, amount=amount, payout=None)
    db.add(bet)

    if position == BetPosition.AGREE:
        market.total_agree_pool = Decimal(str(market.total_agree_pool)) + amount
    else:
        market.total_disagree_pool = Decimal(str(market.total_disagree_pool)) + amount

    db.commit()
    db.refresh(bet)
    return bet