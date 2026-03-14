import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class TransactionType(str, enum.Enum):
    STARTING_CREDIT = "starting_credit"  # onboarding grant
    BET_DEBIT = "bet_debit"              # credits locked when bet placed
    WIN_CREDIT = "win_credit"            # payout after winning
    REFUND = "refund"                    # returned on stale/cancelled market


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    # NUMERIC(12,2) — no floats for financial values
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)

    type: Mapped[TransactionType] = mapped_column(
        Enum(TransactionType, name="transaction_type_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )

    # Links this transaction back to the relevant bet or market for auditing
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="wallet_transactions")