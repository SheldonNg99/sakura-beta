from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.schemas.wallet import (
    WalletBalanceResponse,
    WalletConnectRequest,
    WalletConnectResponse,
    WalletHistoryResponse,
    WalletTransactionResponse,
)
from app.services import wallet_service

router = APIRouter(prefix="/wallet", tags=["wallet"])


@router.get("/balance", response_model=WalletBalanceResponse)
def get_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WalletBalanceResponse:
    balance = wallet_service.get_balance(current_user.id, db)
    return WalletBalanceResponse(user_id=current_user.id, balance=balance)


@router.get("/history", response_model=WalletHistoryResponse)
def get_history(
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WalletHistoryResponse:
    transactions, total = wallet_service.get_transaction_history(
        current_user.id, db, limit=limit, offset=offset
    )
    return WalletHistoryResponse(
        transactions=[WalletTransactionResponse.model_validate(t) for t in transactions],
        total=total,
    )


@router.post("/connect", response_model=WalletConnectResponse)
def connect_wallet(
    body: WalletConnectRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WalletConnectResponse:
    # Check if another user already owns this address
    existing = db.query(User).filter(
        User.stacks_address == body.stacks_address,
        User.id != current_user.id,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This wallet address is already linked to another account",
        )

    current_user.stacks_address = body.stacks_address
    db.commit()
    db.refresh(current_user)

    return WalletConnectResponse(
        user_id=current_user.id,
        stacks_address=current_user.stacks_address,
    )


@router.delete("/connect", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_wallet(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    current_user.stacks_address = None
    db.commit()