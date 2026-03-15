# app/services/agent_service.py
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.agent import Agent
from app.services.agent_sandbox import AgentValidationError, validate_agent_code

logger = logging.getLogger(__name__)

# ── Upload ─────────────────────────────────────────────────────────────────────

def upload_agent(user_id: int, name: str, code: str, db: Session) -> Agent:
    """
    Validates and stores a new agent script for a user.

    Raises:
      - 400 if the code fails sandbox validation
      - 409 if the user already has an agent with the same name
    """
    # Duplicate name check (unique per user enforced by DB, but give a clean error)
    existing = db.execute(
        select(Agent).where(Agent.user_id == user_id, Agent.name == name)
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have an agent named '{name}'. Choose a different name or deactivate the existing one.",
        )

    # Sandbox validation — raises 400 on any violation
    try:
        validate_agent_code(code)
    except AgentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Agent validation failed: {exc}",
        ) from exc

    agent = Agent(
        user_id=user_id,
        name=name,
        code=code,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    logger.info(f"agent_service: user {user_id} uploaded agent '{name}' (id={agent.id})")
    return agent


# ── Queries ────────────────────────────────────────────────────────────────────

def get_agents_for_user(user_id: int, db: Session) -> list[Agent]:
    """Returns all agents owned by the user, newest first."""
    return db.execute(
        select(Agent)
        .where(Agent.user_id == user_id)
        .order_by(Agent.created_at.desc())
    ).scalars().all()


def get_all_active_agents(db: Session) -> list[Agent]:
    """
    Returns all active agents across all users.
    Used by the prediction worker to run each agent.
    """
    return db.execute(
        select(Agent).where(Agent.is_active == True)  # noqa: E712
    ).scalars().all()


def get_agent_by_id(agent_id: int, db: Session) -> Agent:
    """Fetches a single agent by ID. Raises 404 if not found."""
    agent = db.get(Agent, agent_id)
    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent {agent_id} not found",
        )
    return agent


# ── Deactivate ─────────────────────────────────────────────────────────────────

def deactivate_agent(agent_id: int, user_id: int, db: Session) -> Agent:
    """
    Soft-deletes an agent. Only the owner can deactivate.
    Deactivated agents are excluded from future prediction runs.
    """
    agent = get_agent_by_id(agent_id, db)

    if agent.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only deactivate your own agents",
        )

    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent is already inactive",
        )

    agent.is_active = False
    db.commit()
    db.refresh(agent)

    logger.info(f"agent_service: agent {agent_id} deactivated by user {user_id}")
    return agent