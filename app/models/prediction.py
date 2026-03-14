import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Direction(str, enum.Enum):
    UP = "up"
    DOWN = "down"


class PredictionOutcome(str, enum.Enum):
    PENDING = "pending"
    CORRECT = "correct"
    INCORRECT = "incorrect"


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    asset: Mapped[str] = mapped_column(String(20), nullable=False, index=True)  # e.g. "BTC-USD"
    direction: Mapped[Direction] = mapped_column(
        Enum(Direction, name="direction_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0–1.0, not a financial value

    # Entry price at prediction generation time — NUMERIC for consistency
    entry_price: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)

    timeframe_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    outcome: Mapped[PredictionOutcome] = mapped_column(
        Enum(PredictionOutcome, name="prediction_outcome_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=PredictionOutcome.PENDING,
        server_default="pending",
    )

    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    market: Mapped["Market"] = relationship(back_populates="prediction", uselist=False)