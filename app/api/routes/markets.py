import os
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.market import BetResponse, MarketResponse, PlaceBetRequest
from app.services import market_service
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

router = APIRouter(prefix="/markets", tags=["markets"])


@router.get("", response_model=list[MarketResponse])
def list_open_markets(
    limit: int = Query(default=20, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[MarketResponse]:
    return market_service.get_open_markets(db, limit=limit, offset=offset)

@router.post("/dev/seed", response_model=list[MarketResponse])
def seed_markets(
    x_dev_secret: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> list[MarketResponse]:
    if x_dev_secret != os.getenv("DEV_SECRET"):
        raise HTTPException(status_code=403, detail="Forbidden")
    from app.services import prediction_service, market_service as ms
    markets = []
    for asset in prediction_service.SUPPORTED_ASSETS:
        prediction = prediction_service.generate_prediction(asset, db)
        market = ms.create_market(prediction, db)
        markets.append(market)
    return markets


@router.get("/{market_id}", response_model=MarketResponse)
def get_market(
    market_id: int,
    db: Session = Depends(get_db),
) -> MarketResponse:
    return market_service.get_market_by_id(market_id, db)


@router.post("/{market_id}/bet", response_model=BetResponse, status_code=201)
def place_bet(
    market_id: int,
    body: PlaceBetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BetResponse:
    return market_service.place_bet(
        user_id=current_user.id,
        market_id=market_id,
        position=body.position,
        amount=body.amount,
        db=db,
    )