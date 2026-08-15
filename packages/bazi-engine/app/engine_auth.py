"""B3-a — shared-secret middleware for the Bazi engine.

The engine is a private Railway service with **no public domain**, so the
attacker set today is "code already inside the Railway project", not the
internet. That is why this ships in OBSERVE mode: it counts unkeyed callers and
rejects nothing. Flipping to enforce (B3-b) is a single env var, and is gated on
evidence — see ``docs/security/audit-2026-08.md``.

Two properties this file exists to guarantee, both easy to lose in a refactor:

1. **The observe path can never change a response.** Every counter touch is
   wrapped; an internal error here degrades to a log line, not a 500. A control
   that is supposed to be invisible must be invisible even when it is broken.
2. **The received key is never logged.** Only presence/absence and a truncated
   SHA-256 of a *rejected* value, which is enough to tell "one drifted service
   sending a stale key" (same fingerprint repeatedly) from "a scanner sending
   junk" (many fingerprints) without writing a live credential to Railway's log
   store.

Counting is a periodic ROLLUP, not one line per request. A scanner would
otherwise flood the log and destroy the very signal B3-b reads.

Env:
    ``ENGINE_KEYS``        comma-separated accept list; any match passes. A list
                           rather than one value so rotation is add-new →
                           redeploy → remove-old with no outage window.
                           Falls back to ``ENGINE_KEY`` when unset, so the steady
                           state can be ONE Railway shared variable referenced by
                           both services (they cannot drift).
    ``ENGINE_REQUIRE_KEY`` truthy ⇒ enforce (401). Default observe.
    ``ENGINE_ENV`` /
    ``RAILWAY_ENVIRONMENT`` production marker — see :func:`is_production`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

logger = logging.getLogger("bazi_engine.auth")

ENGINE_KEY_HEADER = "x-engine-key"
CALLER_HEADER = "x-engine-caller"
REQUEST_ID_HEADER = "x-request-id"

#: Never authenticated, never counted. Railway健康檢查 and the API's own
#: ``health.controller.ts`` hop land here. If a Railway healthcheck path is ever
#: configured it MUST be in this set, or enforcing would fail every deploy.
EXEMPT_PATHS = frozenset({"/health"})

ROLLUP_INTERVAL_SECONDS = 60.0

#: Bounds on what a caller can push into our log line. Both `path` and `caller`
#: are attacker-controllable, so they are truncated and charset-restricted —
#: unbounded values are log injection (a `\n` forges a whole log record) and a
#: scanner walking random paths would otherwise grow the rollup without limit.
_MAX_LABEL_LEN = 48
_MAX_TRACKED_PATHS = 50
_MAX_REJECTED_FINGERPRINTS = 10
_LABEL_SAFE = re.compile(r"[^A-Za-z0-9._/-]")
_OTHER = "<other>"

OUTCOME_KEYED = "keyed"
OUTCOME_ABSENT = "absent"
OUTCOME_INVALID = "invalid"
OUTCOME_UNCONFIGURED = "unconfigured"

_TRUTHY = {"1", "true", "yes", "on"}


def configure_auth_logging() -> None:
    """Give ``bazi_engine.auth`` a handler, and give it ONLY to that logger.

    The engine configures no logging at all, so without this the rollup is
    emitted into a logger with no handler and disappears. The obvious fix —
    ``logging.basicConfig(level=INFO)`` — would switch on INFO for every library
    in the process, including httpx, which logs full request URLs. Under the
    domain PII rule that is a leak waiting to happen, so the level and the
    handler are set on THIS logger only.

    ``propagate`` is deliberately left at its default ``True``. Setting it False
    would stop a second copy of each record if someone later called
    ``basicConfig`` — but it also makes these records invisible to anything that
    handles at the root, including pytest's ``caplog``, and the tests that read
    this log are the ones asserting a key is never written to it. A safety
    assertion that silently stops running is worse than a duplicate log line.
    """
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def load_engine_keys() -> List[str]:
    """Accepted keys, in order. Empty list ⇒ the engine cannot authenticate."""
    raw = _env("ENGINE_KEYS") or _env("ENGINE_KEY")
    return [k for k in (part.strip() for part in raw.split(",")) if k]


def require_key_enabled() -> bool:
    """True ⇒ enforce mode (B3-b). Default False ⇒ observe."""
    return _env("ENGINE_REQUIRE_KEY").lower() in _TRUTHY


def is_production() -> bool:
    """Prod marker, zero-config on Railway and overridable everywhere else.

    Railway injects ``RAILWAY_ENVIRONMENT``; ``ENGINE_ENV`` wins when set so a
    staging service on Railway can opt out. Local dev and CI set neither, so
    ``/docs`` stays available there.
    """
    explicit = _env("ENGINE_ENV").lower()
    if explicit:
        return explicit in {"production", "prod"}
    return _env("RAILWAY_ENVIRONMENT").lower() in {"production", "prod"}


def fingerprint_rejected_key(value: str) -> str:
    """Truncated SHA-256 — enough to correlate repeats, useless as a credential."""
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()[:12]


def match_key(presented: str, accepted: List[str]) -> bool:
    """Constant-time membership test.

    ``hmac.compare_digest`` on ``str`` raises when either side is non-ASCII, so
    both sides are encoded first — a key with a stray non-ASCII character would
    otherwise take down every request instead of just failing to match.
    """
    presented_b = presented.encode("utf-8", "replace")
    matched = False
    for candidate in accepted:
        # No early break: comparing against every candidate keeps the work done
        # independent of WHICH key matched.
        if hmac.compare_digest(presented_b, candidate.encode("utf-8", "replace")):
            matched = True
    return matched


def _label(value: str, fallback: str) -> str:
    cleaned = _LABEL_SAFE.sub("_", (value or "").strip())[:_MAX_LABEL_LEN]
    return cleaned or fallback


class RejectionCounter:
    """Per-(outcome, path, caller) tallies, flushed as a periodic rollup.

    Thread-safe because M3 will move the engine to ``--workers`` and a sync
    threadpool; per-process counters are the intended granularity (each worker
    emits its own rollup line).
    """

    def __init__(self, interval_seconds: float = ROLLUP_INTERVAL_SECONDS) -> None:
        self._interval = interval_seconds
        self._lock = threading.Lock()
        self._counts: Dict[Tuple[str, str, str], int] = {}
        self._paths: set = set()
        self._fingerprints: Dict[str, int] = {}
        self._window_started = time.monotonic()

    def record(
        self,
        outcome: str,
        path: str,
        caller: str,
        rejected_fingerprint: Optional[str] = None,
    ) -> None:
        safe_path = _label(path, "/")
        safe_caller = _label(caller, "unknown")
        with self._lock:
            if safe_path not in self._paths:
                if len(self._paths) >= _MAX_TRACKED_PATHS:
                    safe_path = _OTHER
                else:
                    self._paths.add(safe_path)
            key = (outcome, safe_path, safe_caller)
            self._counts[key] = self._counts.get(key, 0) + 1
            if rejected_fingerprint and len(self._fingerprints) < _MAX_REJECTED_FINGERPRINTS:
                self._fingerprints[rejected_fingerprint] = (
                    self._fingerprints.get(rejected_fingerprint, 0) + 1
                )

    def due(self, now: Optional[float] = None) -> bool:
        with self._lock:
            if not self._counts:
                return False
            return (now or time.monotonic()) - self._window_started >= self._interval

    def drain(self, now: Optional[float] = None) -> Optional[Dict[str, Any]]:
        """Take the current window and reset. ``None`` when nothing was seen."""
        with self._lock:
            if not self._counts:
                self._window_started = now or time.monotonic()
                return None
            counts = self._counts
            fingerprints = self._fingerprints
            started = self._window_started
            self._counts = {}
            self._paths = set()
            self._fingerprints = {}
            self._window_started = now or time.monotonic()

        totals: Dict[str, int] = {}
        detail: Dict[str, Dict[str, int]] = {}
        for (outcome, path, caller), n in sorted(counts.items()):
            totals[outcome] = totals.get(outcome, 0) + n
            detail.setdefault(outcome, {})[f"{path}<-{caller}"] = n
        return {
            "mode": "enforce" if require_key_enabled() else "observe",
            "window_s": round((now or time.monotonic()) - started, 1),
            "totals": totals,
            "by_path": detail,
            "rejected_key_fingerprints": fingerprints,
        }


def _emit(payload: Dict[str, Any]) -> None:
    """One greppable line. ``ENGINE-AUTH-ROLLUP`` is the Railway-log search term."""
    unkeyed = payload["totals"].get(OUTCOME_ABSENT, 0) + payload["totals"].get(
        OUTCOME_INVALID, 0
    )
    line = "ENGINE-AUTH-ROLLUP " + json.dumps(payload, sort_keys=True, ensure_ascii=False)
    # Rejections are the signal B3-b reads; keyed-only windows are routine.
    (logger.warning if unkeyed else logger.info)(line)


class EngineKeyMiddleware:
    """Pure-ASGI (not ``BaseHTTPMiddleware``).

    ``BaseHTTPMiddleware`` wraps every request in an anyio task group and a
    memory object stream. This service's whole performance argument is a 3ms
    median, and the work here is "read one header" — the wrapper would cost more
    than the check.
    """

    def __init__(self, app: Callable[..., Awaitable[None]], counter: Optional[RejectionCounter] = None):
        self.app = app
        self.counter = counter if counter is not None else RejectionCounter()

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        outcome = OUTCOME_ABSENT
        caller = "unknown"
        fingerprint: Optional[str] = None
        try:
            headers = Headers(scope=scope)
            caller = headers.get(CALLER_HEADER) or "unknown"
            presented = (headers.get(ENGINE_KEY_HEADER) or "").strip()
            accepted = load_engine_keys()
            if not accepted:
                outcome = OUTCOME_UNCONFIGURED
            elif not presented:
                outcome = OUTCOME_ABSENT
            elif match_key(presented, accepted):
                outcome = OUTCOME_KEYED
            else:
                outcome = OUTCOME_INVALID
                fingerprint = fingerprint_rejected_key(presented)
            self.counter.record(outcome, path, caller, fingerprint)
            if self.counter.due():
                payload = self.counter.drain()
                if payload:
                    _emit(payload)
        except Exception:  # noqa: BLE001 — see the module docstring, property (1)
            # An observability control must never be the reason a request fails.
            logger.exception("engine-auth bookkeeping failed; request unaffected")
            if not require_key_enabled():
                await self.app(scope, receive, send)
                return
            # In enforce mode we cannot prove the caller was keyed, so we must
            # not pass it through: fail CLOSED, never open.
            outcome = OUTCOME_ABSENT

        if require_key_enabled() and outcome != OUTCOME_KEYED:
            # Fail-closed covers `unconfigured` too: a prod engine with no keys
            # set refuses everything rather than admitting everyone. The
            # deployment error is loud instead of silent.
            request_id = Headers(scope=scope).get(REQUEST_ID_HEADER) or ""
            response = JSONResponse(
                status_code=401,
                content={"detail": "Engine authentication required."},
                headers={REQUEST_ID_HEADER: request_id} if request_id else None,
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def flush_counter(counter: RejectionCounter) -> None:
    """Emit whatever is left. Called on shutdown.

    Without this the final window is lost whenever the engine goes idle or is
    redeployed — exactly the window a scan-then-stop would land in.
    """
    try:
        payload = counter.drain()
        if payload:
            _emit(payload)
    except Exception:  # noqa: BLE001
        logger.exception("engine-auth final flush failed")
