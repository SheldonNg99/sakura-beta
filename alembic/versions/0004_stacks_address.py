"""Add stacks_address to users

Revision ID: 0004_stacks_address
Revises: 0003_agents
Create Date: 2026-03-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_stacks_address"
down_revision = "0003_agents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("stacks_address", sa.String(64), nullable=True),
    )
    op.create_index("ix_users_stacks_address", "users", ["stacks_address"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_stacks_address", table_name="users")
    op.drop_column("users", "stacks_address")