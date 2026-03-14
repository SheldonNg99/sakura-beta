from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

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