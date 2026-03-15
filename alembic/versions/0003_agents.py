"""Add agents table and agent_id FK on predictions

Revision ID: 0003_agents
Revises: 0002_refresh_tokens
Create Date: 2026-03-15 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_agents"
down_revision = "0002_refresh_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- agents ---
    op.create_table(
        "agents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        # Store raw Python source — max 1MB enforced at API layer
        sa.Column("code", sa.Text, nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean,
            nullable=False,
            server_default="true",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_agents_user_id", "agents", ["user_id"])
    op.create_index("ix_agents_is_active", "agents", ["is_active"])
    # Enforce unique agent names per user — prevents duplicate uploads
    op.create_index(
        "ix_agents_user_id_name_unique",
        "agents",
        ["user_id", "name"],
        unique=True,
    )

    # --- predictions.agent_id FK (nullable — system predictions keep NULL) ---
    op.add_column(
        "predictions",
        sa.Column("agent_id", sa.Integer, sa.ForeignKey("agents.id"), nullable=True),
    )
    op.create_index("ix_predictions_agent_id", "predictions", ["agent_id"])


def downgrade() -> None:
    op.drop_index("ix_predictions_agent_id", table_name="predictions")
    op.drop_column("predictions", "agent_id")

    op.drop_index("ix_agents_user_id_name_unique", table_name="agents")
    op.drop_index("ix_agents_is_active", table_name="agents")
    op.drop_index("ix_agents_user_id", table_name="agents")
    op.drop_table("agents")