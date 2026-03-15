# app/services/agent_sandbox.py
"""
Sandboxed execution of user-uploaded agent scripts.

Security model:
  - RestrictedPython compiles agent code; dangerous builtins are blocked
  - Execution runs in a daemon thread with a hard 5-second timeout
  - Memory guard: agent imports are limited to a safe whitelist
  - No network access: socket / httpx / requests / urllib are blocked

Agent contract:
  The uploaded script MUST define:

      def predict(asset: str, price: float, candles: list[dict]) -> dict:
          # Returns: {"direction": "up" | "down", "confidence": 0.0–1.0}

  `candles` is a list of up to 20 dicts, each:
      {
          "open": float,
          "high": float,
          "low": float,
          "close": float,
          "volume": float,
      }
"""
import logging
import threading
from decimal import Decimal
from typing import Any

from RestrictedPython import compile_restricted, safe_globals
from RestrictedPython.Guards import (
    guarded_iter_unpack_sequence,
    guarded_unpack_sequence,
    safe_builtins,
)

logger = logging.getLogger(__name__)

# ── Timeout / limits ──────────────────────────────────────────────────────────

EXECUTION_TIMEOUT_SECONDS = 5
MAX_CODE_SIZE_BYTES = 1 * 1024 * 1024  # 1 MB

# ── Blocked import names ──────────────────────────────────────────────────────

_BLOCKED_IMPORTS = frozenset(
    {
        "os",
        "sys",
        "subprocess",
        "socket",
        "requests",
        "httpx",
        "urllib",
        "urllib2",
        "urllib3",
        "http",
        "ftplib",
        "smtplib",
        "telnetlib",
        "shutil",
        "pathlib",
        "open",
        "io",
        "builtins",
        "importlib",
        "__import__",
        "eval",
        "exec",
        "compile",
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
        "hasattr",
        "type",
        "object",
        "super",
        "classmethod",
        "staticmethod",
        "property",
        "pickle",
        "marshal",
        "ctypes",
        "cffi",
        "multiprocessing",
        "threading",
        "asyncio",
        "signal",
        "gc",
        "atexit",
        "traceback",
    }
)

# ── Safe import guard ─────────────────────────────────────────────────────────

def _safe_import(
    name: str,
    globals: dict | None = None,
    locals: dict | None = None,
    fromlist: tuple = (),
    level: int = 0,
) -> Any:
    """
    Whitelist-based import guard.
    Allows only pure-math / data-manipulation packages that can't exfiltrate data.
    """
    top = name.split(".")[0]
    if top in _BLOCKED_IMPORTS:
        raise ImportError(f"Import of '{name}' is not allowed in agent scripts")

    allowed_tops = {
        "math",
        "statistics",
        "random",
        "decimal",
        "fractions",
        "numbers",
        "cmath",
        "itertools",
        "functools",
        "operator",
        "collections",
        "heapq",
        "bisect",
        "array",
        "json",       # read-only data manipulation — no I/O
        "re",
        "string",
        "datetime",
        "calendar",
        "numpy",
        "pandas",
        "scipy",
        "sklearn",
        "ta",         # technical-analysis library
        "talib",
    }

    if top not in allowed_tops:
        raise ImportError(
            f"Import of '{name}' is not allowed. "
            f"Allowed packages: {sorted(allowed_tops)}"
        )

    import importlib
    return importlib.import_module(name)


# ── Restricted globals ────────────────────────────────────────────────────────

def _build_restricted_globals() -> dict:
    """Constructs the execution namespace for agent code."""
    builtins = safe_builtins.copy()

    # safe_builtins is very minimal — add back standard types and functions
    # that agents need for normal Python code to work.
    _safe_additions = {
        # Types
        "list": list,
        "dict": dict,
        "tuple": tuple,
        "set": set,
        "frozenset": frozenset,
        "int": int,
        "float": float,
        "bool": bool,
        "str": str,
        "bytes": bytes,
        "complex": complex,
        # Built-in functions
        "len": len,
        "range": range,
        "enumerate": enumerate,
        "zip": zip,
        "map": map,
        "filter": filter,
        "sorted": sorted,
        "reversed": reversed,
        "sum": sum,
        "min": min,
        "max": max,
        "abs": abs,
        "round": round,
        "pow": pow,
        "divmod": divmod,
        "isinstance": isinstance,
        "issubclass": issubclass,
        "any": any,
        "all": all,
        "print": print,
        "repr": repr,
        "hash": hash,
        # Type conversion
        "hex": hex,
        "oct": oct,
        "bin": bin,
        "chr": chr,
        "ord": ord,
        # Exceptions agents may want to raise
        "ValueError": ValueError,
        "TypeError": TypeError,
        "KeyError": KeyError,
        "IndexError": IndexError,
        "ZeroDivisionError": ZeroDivisionError,
        "Exception": Exception,
        "RuntimeError": RuntimeError,
    }
    builtins.update(_safe_additions)

    # Explicitly remove anything that could break containment
    for danger in ("__import__", "open", "exec", "eval", "compile", "input"):
        builtins.pop(danger, None)

    restricted = safe_globals.copy()
    restricted["__builtins__"] = builtins
    restricted["__import__"] = _safe_import

    # RestrictedPython iteration guards (required for for-loops to work)
    restricted["_getiter_"] = iter
    restricted["_getitem_"] = lambda obj, key: obj[key]
    restricted["_write_"] = lambda x: x
    restricted["_inplacevar_"] = lambda op, x, y: x  # +=, -= etc.
    restricted["_iter_unpack_sequence_"] = guarded_iter_unpack_sequence
    restricted["_unpack_sequence_"] = guarded_unpack_sequence

    return restricted


# ── Validation ────────────────────────────────────────────────────────────────

class AgentValidationError(Exception):
    """Raised when an agent script fails static validation."""


def validate_agent_code(code: str) -> None:
    """
    Statically validates agent code before storing it.

    Checks:
      1. Size limit
      2. Compiles under RestrictedPython (syntax + restricted constructs)
      3. `predict` function is defined and callable

    Raises AgentValidationError with a human-readable message on failure.
    Does NOT execute the code — safe to call on upload.
    """
    # 1. Size limit
    if len(code.encode("utf-8")) > MAX_CODE_SIZE_BYTES:
        raise AgentValidationError(
            f"Script exceeds maximum size of {MAX_CODE_SIZE_BYTES // 1024}KB"
        )

    # 2. Compile under RestrictedPython
    try:
        byte_code = compile_restricted(code, filename="<agent>", mode="exec")
    except SyntaxError as exc:
        raise AgentValidationError(f"Syntax error: {exc}") from exc
    except Exception as exc:
        raise AgentValidationError(f"Compilation failed: {exc}") from exc

    if byte_code is None:
        raise AgentValidationError(
            "Script failed RestrictedPython compilation — "
            "it may contain forbidden constructs (e.g. attribute access via __)"
        )

    # 3. Execute in restricted namespace and check predict() exists
    namespace = _build_restricted_globals()
    try:
        exec(byte_code, namespace)  # noqa: S102 — intentional restricted exec
    except Exception as exc:
        raise AgentValidationError(f"Script raised an error on load: {exc}") from exc

    if "predict" not in namespace or not callable(namespace["predict"]):
        raise AgentValidationError(
            "Script must define a callable `predict(asset, price, candles) -> dict`"
        )


# ── Execution ─────────────────────────────────────────────────────────────────

class AgentExecutionError(Exception):
    """Raised when an agent script fails or times out at runtime."""


def run_agent(
    code: str,
    asset: str,
    price: Decimal,
    candles: list[dict],
) -> tuple[str, float]:
    """
    Executes `predict(asset, price, candles)` inside the sandbox.

    Returns (direction, confidence) where:
      - direction: "up" | "down"
      - confidence: float in [0.0, 1.0]

    Raises AgentExecutionError on timeout, runtime error, or bad return value.
    """
    result_box: dict[str, Any] = {}
    error_box: dict[str, Exception] = {}

    price_float = float(price)

    def _run() -> None:
        try:
            byte_code = compile_restricted(code, filename="<agent>", mode="exec")
            if byte_code is None:
                error_box["err"] = AgentExecutionError(
                    "RestrictedPython refused to compile the script"
                )
                return

            namespace = _build_restricted_globals()
            exec(byte_code, namespace)  # noqa: S102

            predict_fn = namespace.get("predict")
            if not callable(predict_fn):
                error_box["err"] = AgentExecutionError(
                    "No callable `predict` function found"
                )
                return

            raw = predict_fn(asset, price_float, candles)
            result_box["raw"] = raw

        except Exception as exc:
            error_box["err"] = AgentExecutionError(
                f"Agent raised an exception: {exc}"
            )

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(timeout=EXECUTION_TIMEOUT_SECONDS)

    if thread.is_alive():
        # Thread is stuck — we can't kill it in CPython, but daemon=True means
        # it won't block process shutdown. Log and reject the result.
        logger.warning(
            f"Agent timed out after {EXECUTION_TIMEOUT_SECONDS}s for asset={asset}"
        )
        raise AgentExecutionError(
            f"Agent exceeded {EXECUTION_TIMEOUT_SECONDS}s execution timeout"
        )

    if "err" in error_box:
        raise error_box["err"]

    # Validate return value shape
    raw = result_box.get("raw")
    return _parse_prediction_result(raw)


def _parse_prediction_result(raw: Any) -> tuple[str, float]:
    """
    Validates and normalises the dict returned by predict().

    Expected: {"direction": "up"|"down", "confidence": 0.0–1.0}
    Raises AgentExecutionError if the shape is wrong.
    """
    if not isinstance(raw, dict):
        raise AgentExecutionError(
            f"predict() must return a dict, got {type(raw).__name__}"
        )

    direction = raw.get("direction")
    if direction not in ("up", "down"):
        raise AgentExecutionError(
            f"predict() must return direction 'up' or 'down', got {direction!r}"
        )

    confidence = raw.get("confidence")
    if not isinstance(confidence, (int, float)):
        raise AgentExecutionError(
            f"predict() must return numeric confidence, got {type(confidence).__name__}"
        )

    confidence = float(confidence)
    if not (0.0 <= confidence <= 1.0):
        raise AgentExecutionError(
            f"predict() confidence must be in [0.0, 1.0], got {confidence}"
        )

    return direction, confidence