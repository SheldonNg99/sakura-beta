import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    stacks_address: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(back_populates="user")
    wallet_transactions: Mapped[list["WalletTransaction"]] = relationship(back_populates="user")
    bets: Mapped[list["Bet"]] = relationship(back_populates="user")
    agents: Mapped[list["Agent"]] = relationship(back_populates="user")