"""Add onchain_market_id to markets

Revision ID: 0005_onchain_market_id
Revises: 0004_stacks_address
Create Date: 2026-03-16 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_onchain_market_id"
down_revision = "0004_stacks_address"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "markets",
        sa.Column("onchain_market_id", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("markets", "onchain_market_id")