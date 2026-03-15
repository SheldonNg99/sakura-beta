# app/models/agent.py
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Owner — the user who uploaded this agent
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )

    # Human-readable name, unique per user (enforced by DB index)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    # Raw Python source code — max 1MB enforced at upload time
    code: Mapped[str] = mapped_column(Text, nullable=False)

    # Soft-delete / disable without losing history
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="agents")
    predictions: Mapped[list["Prediction"]] = relationship(back_populates="agent")