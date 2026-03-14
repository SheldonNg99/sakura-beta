from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.wallet import TransactionType, WalletTransaction

# Minimum bet enforced here so wallet_service is the single source of truth
MIN_BET_AMOUNT = Decimal("1.00")


def get_balance(user_id: int, db: Session) -> Decimal:
    """
    Compute balance from the ledger — never trust a stored column.
    Returns Decimal("0.00") if no transactions exist yet.
    """
    result = db.execute(
        select(func.coalesce(func.sum(WalletTransaction.amount), Decimal("0.00")))
        .where(WalletTransaction.user_id == user_id)
    ).scalar()

    return Decimal(result)


def debit(
    user_id: int,
    amount: Decimal,
    reference_id: int,
    db: Session,
) -> WalletTransaction:
    """
    Deduct credits when a bet is placed.
    Uses SELECT FOR UPDATE to prevent race conditions on concurrent bets.
    Raises 400 if balance is insufficient or amount is below minimum.
    """
    if amount < MIN_BET_AMOUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum bet is {MIN_BET_AMOUNT} credits",
        )

    # Lock all rows for this user while we check balance
    # Prevents two concurrent bets from both passing the balance check
    db.execute(
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .with_for_update()
    )

    balance = get_balance(user_id, db)
    if balance < amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient credits. Balance: {balance}",
        )

    tx = WalletTransaction(
        user_id=user_id,
        amount=-amount,  # negative — debit
        type=TransactionType.BET_DEBIT,
        reference_id=reference_id,
    )
    db.add(tx)
    # Caller is responsible for db.commit() — keeps transaction boundaries clean
    return tx


def credit(
    user_id: int,
    amount: Decimal,
    reference_id: int,
    db: Session,
) -> WalletTransaction:
    """
    Add credits — used for winnings payout.
    Always positive. No balance check needed.
    """
    if amount <= Decimal("0.00"):
        raise ValueError(f"Credit amount must be positive, got {amount}")

    tx = WalletTransaction(
        user_id=user_id,
        amount=amount,  # positive — credit
        type=TransactionType.WIN_CREDIT,
        reference_id=reference_id,
    )
    db.add(tx)
    return tx


def refund(
    user_id: int,
    amount: Decimal,
    reference_id: int,
    db: Session,
) -> WalletTransaction:
    """
    Return credits when a market goes stale or is cancelled.
    Identical to credit but with a distinct transaction type for auditability.
    """
    if amount <= Decimal("0.00"):
        raise ValueError(f"Refund amount must be positive, got {amount}")

    tx = WalletTransaction(
        user_id=user_id,
        amount=amount,
        type=TransactionType.REFUND,
        reference_id=reference_id,
    )
    db.add(tx)
    return tx


def get_transaction_history(
    user_id: int,
    db: Session,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[WalletTransaction], int]:
    """Returns paginated transactions and total count."""
    query = (
        select(WalletTransaction)
        .where(WalletTransaction.user_id == user_id)
        .order_by(WalletTransaction.created_at.desc())
    )
    total = db.execute(
        select(func.count()).select_from(query.subquery())
    ).scalar()

    transactions = db.execute(
        query.limit(limit).offset(offset)
    ).scalars().all()

    return list(transactions), total