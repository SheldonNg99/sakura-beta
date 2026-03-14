import hashlib
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    refresh_token_expiry,
    verify_password,
)
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.wallet import TransactionType, WalletTransaction

STARTING_CREDITS = Decimal("100.00")


def _hash_token(raw_token: str) -> str:
    """SHA-256 hash of the raw token — what we store in the DB."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


# ── Register ───────────────────────────────────────────────────────────────────

def register_user(email: str, password: str, db: Session) -> User:
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    db.flush()  # get user.id before committing

    grant = WalletTransaction(
        user_id=user.id,
        amount=STARTING_CREDITS,
        type=TransactionType.STARTING_CREDIT,
        reference_id=None,
    )
    db.add(grant)
    db.commit()
    db.refresh(user)
    return user


# ── Login ──────────────────────────────────────────────────────────────────────

def login_user(email: str, password: str, db: Session) -> tuple[str, str]:
    """
    Validates credentials and returns (access_token, refresh_token).
    Caller is responsible for setting the refresh token cookie.
    """
    user = db.query(User).filter(User.email == email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    access_token = create_access_token(user.id)
    refresh_token = _create_refresh_token(user.id, db)
    db.commit()
    return access_token, refresh_token


# ── Refresh ────────────────────────────────────────────────────────────────────

def refresh_access_token(raw_token: str, db: Session) -> tuple[str, str]:
    """
    Validates the refresh token, rotates it (old one revoked, new one issued),
    and returns (new_access_token, new_refresh_token).

    Rotation prevents refresh token reuse attacks.
    """
    token_hash = _hash_token(raw_token)
    now = datetime.now(timezone.utc)

    stored = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712
            RefreshToken.expires_at > now,
        )
        .first()
    )

    if not stored:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    # Revoke the old token (rotation)
    stored.revoked = True
    db.flush()

    # Issue new pair
    access_token = create_access_token(stored.user_id)
    new_refresh_token = _create_refresh_token(stored.user_id, db)

    db.commit()
    return access_token, new_refresh_token


# ── Logout ─────────────────────────────────────────────────────────────────────

def logout_user(raw_token: str, db: Session) -> None:
    """Revokes the refresh token. Cookie deletion is handled by the route."""
    token_hash = _hash_token(raw_token)
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if stored:
        stored.revoked = True
        db.commit()


# ── Internal ───────────────────────────────────────────────────────────────────

def _create_refresh_token(user_id: int, db: Session) -> str:
    """Generates a raw refresh token, stores its hash, returns the raw value."""
    raw_token = generate_refresh_token()
    token_record = RefreshToken(
        user_id=user_id,
        token_hash=_hash_token(raw_token),
        expires_at=refresh_token_expiry(),
        revoked=False,
    )
    db.add(token_record)
    # Caller commits
    return raw_token