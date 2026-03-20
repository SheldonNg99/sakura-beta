from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.wallet import TransactionType


class WalletBalanceResponse(BaseModel):
    user_id: int
    balance: Decimal


class WalletTransactionResponse(BaseModel):
    id: int
    amount: Decimal
    type: TransactionType
    reference_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class WalletHistoryResponse(BaseModel):
    transactions: list[WalletTransactionResponse]
    total: int


# ── Stacks wallet connect ──────────────────────────────────────────────────────

class WalletConnectRequest(BaseModel):
    stacks_address: str

    @field_validator("stacks_address")
    @classmethod
    def validate_address(cls, v: str) -> str:
        v = v.strip()
        if not (v.startswith("SP") or v.startswith("ST")):
            raise ValueError("Invalid Stacks address — must start with SP or ST")
        if len(v) < 30 or len(v) > 64:
            raise ValueError("Invalid Stacks address length")
        return v


class WalletConnectResponse(BaseModel):
    user_id: int
    stacks_address: str
    message: str = "Wallet connected successfully"