"""Initial schema — users, wallet, predictions, markets, bets

Revision ID: 0001_initial_schema
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Enums ---
    transaction_type_enum = sa.Enum(
        "starting_credit", "bet_debit", "win_credit", "refund",
        name="transaction_type_enum",
    )
    direction_enum = sa.Enum("up", "down", name="direction_enum")
    prediction_outcome_enum = sa.Enum(
        "pending", "correct", "incorrect",
        name="prediction_outcome_enum",
    )
    market_status_enum = sa.Enum(
        "open", "betting_closed", "resolved", "stale",
        name="market_status_enum",
    )
    bet_position_enum = sa.Enum("agree", "disagree", name="bet_position_enum")

    # --- users ---
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # --- wallet_transactions ---
    op.create_table(
        "wallet_transactions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("type", transaction_type_enum, nullable=False),
        sa.Column("reference_id", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_wallet_transactions_user_id", "wallet_transactions", ["user_id"])

    # --- predictions ---
    op.create_table(
        "predictions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("asset", sa.String(20), nullable=False),
        sa.Column("direction", direction_enum, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("entry_price", sa.Numeric(18, 8), nullable=False),
        sa.Column("timeframe_minutes", sa.Integer, nullable=False),
        sa.Column("outcome", prediction_outcome_enum, nullable=False, server_default="pending"),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_predictions_asset", "predictions", ["asset"])

    # --- markets ---
    op.create_table(
        "markets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("prediction_id", sa.Integer, sa.ForeignKey("predictions.id"), nullable=False),
        sa.Column("status", market_status_enum, nullable=False, server_default="open"),
        sa.Column("total_agree_pool", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_disagree_pool", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("betting_closes_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prediction_target_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolution_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_markets_prediction_id", "markets", ["prediction_id"], unique=True)
    op.create_index("ix_markets_status", "markets", ["status"])
    # Composite index — resolution worker's primary query
    op.create_index(
        "ix_markets_resolution_time_status",
        "markets",
        ["resolution_time", "status"],
    )

    # --- bets ---
    op.create_table(
        "bets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("market_id", sa.Integer, sa.ForeignKey("markets.id"), nullable=False),
        sa.Column("position", bet_position_enum, nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("payout", sa.Numeric(12, 2), nullable=True),
        sa.Column(
            "placed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_bets_user_id", "bets", ["user_id"])
    op.create_index("ix_bets_market_id", "bets", ["market_id"])


def downgrade() -> None:
    op.drop_table("bets")
    op.drop_table("markets")
    op.drop_table("predictions")
    op.drop_table("wallet_transactions")
    op.drop_table("users")

    # Drop enums explicitly (Postgres doesn't auto-clean them)
    for enum_name in [
        "bet_position_enum",
        "market_status_enum",
        "prediction_outcome_enum",
        "direction_enum",
        "transaction_type_enum",
    ]:
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)