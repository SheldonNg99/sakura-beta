# app/services/stacks_client.py
"""
Backend client for calling the Sakura Clarity contract.
Uses Node.js scripts to build and broadcast Stacks transactions.
"""
import hashlib
import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

STACKS_API_URL = os.getenv("STACKS_API_URL", "https://api.testnet.hiro.so")
CONTRACT_ADDRESS = os.getenv("STACKS_CONTRACT_ADDRESS", "")
CONTRACT_NAME = "sakura-market-v5"
DEPLOYER_KEY = os.getenv("STACKS_DEPLOYER_KEY", "")

_CREATE_SCRIPT_PATH = Path(__file__).parent / "create_market.js"
_CALL_SCRIPT_PATH = Path(__file__).parent / "contract_call.js"

_HTTP_HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}


def _make_prediction_hash(prediction_id: int, direction: str, confidence: float) -> str:
    payload = f"{prediction_id}:{direction}:{confidence:.4f}"
    return hashlib.sha256(payload.encode()).hexdigest()


def _safe_get(url: str, timeout: int = 15) -> dict | None:
    """GET with error handling for non-JSON / rate-limited responses."""
    try:
        resp = httpx.get(url, timeout=timeout, headers=_HTTP_HEADERS, follow_redirects=True)
        if resp.status_code != 200:
            logger.warning(f"stacks_client: GET {url} returned {resp.status_code}")
            return None
        return resp.json()
    except Exception as exc:
        logger.warning(f"stacks_client: GET failed — {exc}")
        return None


def _safe_post(url: str, payload: dict, timeout: int = 15) -> dict | None:
    """POST with error handling for non-JSON / rate-limited responses."""
    try:
        resp = httpx.post(url, json=payload, timeout=timeout, headers=_HTTP_HEADERS, follow_redirects=True)
        if resp.status_code != 200:
            logger.warning(f"stacks_client: POST {url} returned {resp.status_code}")
            return None
        return resp.json()
    except Exception as exc:
        logger.warning(f"stacks_client: POST failed — {exc}")
        return None


def _wait_for_tx(txid: str, max_attempts: int = 15) -> bool:
    """Polls until tx confirms. Returns True on success."""
    for attempt in range(max_attempts):
        time.sleep(12)
        data = _safe_get(f"{STACKS_API_URL}/extended/v1/tx/{txid}")
        if not data:
            continue

        tx_status = data.get("tx_status")
        if tx_status == "success":
            return True
        elif tx_status in ("abort_by_response", "abort_by_post_condition"):
            logger.error(f"stacks_client: tx {txid} aborted — {data.get('tx_result')}")
            return False

    logger.error(f"stacks_client: tx {txid} did not confirm after {max_attempts} attempts")
    return False


def _wait_for_market_id(txid: str, max_attempts: int = 15) -> int | None:
    """
    Polls until tx confirms, then reads the market ID from the tx result.
    create-market returns (ok u<market-id>), so we parse tx_result.repr.
    """
    for attempt in range(max_attempts):
        time.sleep(12)
        data = _safe_get(f"{STACKS_API_URL}/extended/v1/tx/{txid}")
        if not data:
            continue

        tx_status = data.get("tx_status")

        if tx_status == "success":
            # tx_result.repr looks like "(ok u12)" — extract the uint
            tx_result = data.get("tx_result", {})
            repr_str = tx_result.get("repr", "")
            match = re.search(r"\(ok\s+u(\d+)\)", repr_str)
            if match:
                return int(match.group(1))

            # Fallback: try reading from hex
            hex_val = tx_result.get("hex", "")
            if hex_val:
                # (ok uint) hex = 0x0700 + uint128
                # Strip prefix and read last 32 hex chars
                try:
                    clean = hex_val[2:] if hex_val.startswith("0x") else hex_val
                    market_id = int(clean[-32:], 16)
                    if market_id > 0:
                        return market_id
                except (ValueError, IndexError):
                    pass

            logger.warning(f"stacks_client: could not parse market ID from tx_result: {tx_result}")
            return None

        elif tx_status in ("abort_by_response", "abort_by_post_condition"):
            logger.error(f"stacks_client: tx {txid} aborted — {data.get('tx_result')}")
            return None

    logger.error(f"stacks_client: tx {txid} did not confirm after {max_attempts} attempts")
    return None


def _call_contract(function_name: str, *args: str) -> str | None:
    """Generic contract call via Node.js script. Returns txid on success."""
    if not CONTRACT_ADDRESS or not DEPLOYER_KEY:
        logger.warning("stacks_client: env vars not set — skipping on-chain call")
        return None

    if not _CALL_SCRIPT_PATH.exists():
        logger.warning(f"stacks_client: contract_call.js not found at {_CALL_SCRIPT_PATH}")
        return None

    try:
        result = subprocess.run(
            ["node", str(_CALL_SCRIPT_PATH), function_name, *args],
            env={
                **os.environ,
                "STACKS_CONTRACT_ADDRESS": CONTRACT_ADDRESS,
                "STACKS_CONTRACT_NAME": CONTRACT_NAME,
                "STACKS_DEPLOYER_KEY": DEPLOYER_KEY,
            },
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            logger.error(f"stacks_client: {function_name} failed — {result.stderr}")
            return None

        output = json.loads(result.stdout.strip())
        txid = output.get("txid")
        if not txid:
            logger.error(f"stacks_client: no txid in {function_name} output — {output}")
            return None

        logger.info(f"stacks_client: {function_name} broadcasted txid={txid}")
        return txid

    except Exception as exc:
        logger.error(f"stacks_client: {function_name} failed — {exc}")
        return None


# ── Public API ────────────────────────────────────────────────────────────────


def create_market_onchain(
    db_market_id: int,
    agent_id: int,
    asset: str,
    direction: str,
    entry_price_usd: float,
    prediction_id: int,
    confidence: float,
    target_block: int,
) -> int | None:
    """Calls create-market on the Clarity contract. Returns on-chain market ID or None."""
    if not CONTRACT_ADDRESS or not DEPLOYER_KEY:
        logger.warning("stacks_client: env vars not set — skipping on-chain market creation")
        return None

    if not _CREATE_SCRIPT_PATH.exists():
        logger.warning(f"stacks_client: create_market.js not found at {_CREATE_SCRIPT_PATH}")
        return None

    try:
        prediction_hash = _make_prediction_hash(prediction_id, direction, confidence)
        entry_price_uint = int(entry_price_usd * 10**8)

        result = subprocess.run(
            [
                "node", str(_CREATE_SCRIPT_PATH),
                str(agent_id),
                asset[:10],
                direction[:4],
                str(entry_price_uint),
                prediction_hash,
                str(target_block),
            ],
            env={
                **os.environ,
                "STACKS_CONTRACT_ADDRESS": CONTRACT_ADDRESS,
                "STACKS_DEPLOYER_KEY": DEPLOYER_KEY,
            },
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            logger.error(f"stacks_client: create_market.js failed — {result.stderr}")
            return None

        output = json.loads(result.stdout.strip())
        txid = output.get("txid")
        if not txid:
            logger.error(f"stacks_client: no txid in output — {output}")
            return None

        logger.info(f"stacks_client: broadcasted create-market txid={txid} for db_market={db_market_id}")

        onchain_id = _wait_for_market_id(txid)
        if onchain_id:
            logger.info(f"stacks_client: db_market={db_market_id} → onchain_market={onchain_id}")
        return onchain_id

    except Exception as exc:
        logger.error(f"stacks_client: create_market_onchain failed for db_market={db_market_id} — {exc}")
        return None


def close_market_onchain(onchain_market_id: int) -> bool:
    """Calls close-market on the Clarity contract. Best-effort."""
    txid = _call_contract("close-market", str(onchain_market_id))
    if not txid:
        return False

    success = _wait_for_tx(txid)
    if success:
        logger.info(f"stacks_client: close-market confirmed for onchain_market={onchain_market_id}")
    return success


def resolve_market_onchain(onchain_market_id: int, agent_correct: bool) -> bool:
    """Calls resolve-market on the Clarity contract. Best-effort."""
    txid = _call_contract(
        "resolve-market",
        str(onchain_market_id),
        "true" if agent_correct else "false",
    )
    if not txid:
        return False

    success = _wait_for_tx(txid)
    if success:
        logger.info(
            f"stacks_client: resolve-market confirmed for onchain_market={onchain_market_id} "
            f"agent_correct={agent_correct}"
        )
    return success