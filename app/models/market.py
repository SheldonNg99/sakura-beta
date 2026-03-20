import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class MarketStatus(str, enum.Enum):
    OPEN = "open"
    BETTING_CLOSED = "betting_closed"
    RESOLVED = "resolved"
    STALE = "stale"


class BetPosition(str, enum.Enum):
    AGREE = "agree"
    DISAGREE = "disagree"


class Market(Base):
    __tablename__ = "markets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    prediction_id: Mapped[int] = mapped_column(
        ForeignKey("predictions.id"), nullable=False, unique=True, index=True
    )

    status: Mapped[MarketStatus] = mapped_column(
        Enum(MarketStatus, name="market_status_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=MarketStatus.OPEN,
        server_default="open",
    )

    total_agree_pool: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    total_disagree_pool: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0, server_default="0")

    # On-chain market ID from the Clarity contract — null until synced
    onchain_market_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    betting_closes_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    prediction_target_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolution_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    prediction: Mapped["Prediction"] = relationship(back_populates="market")
    bets: Mapped[list["Bet"]] = relationship(back_populates="market")


class Bet(Base):
    __tablename__ = "bets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    market_id: Mapped[int] = mapped_column(ForeignKey("markets.id"), nullable=False, index=True)

    position: Mapped[BetPosition] = mapped_column(
        Enum(BetPosition, name="bet_position_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )

    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payout: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    placed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="bets")
    market: Mapped["Market"] = relationship(back_populates="bets")