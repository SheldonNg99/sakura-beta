import secrets
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── Passwords ──────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── Access Token (JWT) ─────────────────────────────────────────────────────────

def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> int | None:
    """Returns user_id if token is valid, None otherwise."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        return int(user_id) if user_id else None
    except JWTError:
        return None


# ── Refresh Token (opaque) ─────────────────────────────────────────────────────

def generate_refresh_token() -> str:
    """Returns a cryptographically random 64-byte hex token."""
    return secrets.token_hex(64)


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


# ── Cookie helpers ─────────────────────────────────────────────────────────────

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_MAX_AGE = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60  # seconds


def set_refresh_cookie(response, token: str) -> None:
    """Attaches the refresh token as an HttpOnly, SameSite=Lax cookie."""
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        max_age=REFRESH_COOKIE_MAX_AGE,
        httponly=True,
        samesite="none",
        secure=True,  # Set to True in production (requires HTTPS)
        path="/auth",  # Scoped to /auth/* — not sent on every request
    )


def clear_refresh_cookie(response) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME, 
        path="/auth",
        samesite="none",
        secure=True,
    )