# app/api/routes/agents.py
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.agent import Agent
from app.models.user import User
from app.services import agent_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

MAX_NAME_LENGTH = 100
MAX_CODE_BYTES = 1 * 1024 * 1024  # 1 MB — matches sandbox constant


# ── Schemas ────────────────────────────────────────────────────────────────────

class AgentResponse(BaseModel):
    id: int
    user_id: int
    name: str
    is_active: bool
    created_at: datetime

    # Deliberately exclude `code` from all responses — don't leak source to others
    model_config = {"from_attributes": True}


class AgentDetailResponse(AgentResponse):
    """Extended response returned only to the owning user — includes their own code."""
    code: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("", response_model=AgentDetailResponse, status_code=201)
async def upload_agent(
    name: str = Form(..., min_length=1, max_length=MAX_NAME_LENGTH),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Agent:
    """
    Upload a new Python agent script.

    - `name`: display name, unique per user
    - `file`: .py file, max 1MB
    - Script must define `predict(asset, price, candles) -> dict`
    """
    # File type check
    if not file.filename or not file.filename.endswith(".py"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .py files are accepted",
        )

    raw_bytes = await file.read()

    # Size check (before decoding to avoid memory waste)
    if len(raw_bytes) > MAX_CODE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum size of {MAX_CODE_BYTES // 1024}KB",
        )

    # Decode
    try:
        code = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be valid UTF-8 encoded Python",
        )

    return agent_service.upload_agent(
        user_id=current_user.id,
        name=name.strip(),
        code=code,
        db=db,
    )


@router.get("", response_model=list[AgentResponse])
def list_my_agents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Agent]:
    """Returns all agents uploaded by the authenticated user."""
    return agent_service.get_agents_for_user(current_user.id, db)


@router.get("/public", response_model=list[AgentResponse])
def list_active_agents(
    db: Session = Depends(get_db),
) -> list[Agent]:
    """
    Public endpoint — returns all active agents.
    Used by the markets page to show which agents have open markets.
    Code is excluded from this response.
    """
    return agent_service.get_all_active_agents(db)


@router.get("/{agent_id}", response_model=AgentDetailResponse)
def get_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Agent:
    """
    Returns full agent detail including source code.
    Only the owning user can view code.
    """
    agent = agent_service.get_agent_by_id(agent_id, db)

    if agent.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own agents",
        )

    return agent


@router.patch("/{agent_id}/deactivate", response_model=AgentResponse)
def deactivate_agent(
    agent_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Agent:
    """Soft-deactivates an agent. Only the owner can do this."""
    return agent_service.deactivate_agent(agent_id, current_user.id, db)