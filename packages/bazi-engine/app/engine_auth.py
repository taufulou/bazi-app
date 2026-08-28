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
#: Compared after stripping a trailing slash — this middleware runs BEFORE the
#: router, so FastAPI's own ``/health/`` → ``/health`` redirect has not happened
#: yet and an exact-match set would 401 a probe configured with a slash.
EXEMPT_PATHS = frozenset({"/health"})

ROLLUP_INTERVAL_SECONDS = 60.0

#: Bounds on what a caller can push into our log line. `path`, `caller` and the
#: echoed request id are ALL attacker-controllable, so each is truncated and
#: charset-restricted: unbounded values are log injection (a `\n` forges a whole
#: log record), and unbounded CARDINALITY is a memory and log-size attack.
#:
#: ⚠️ `caller` needs its own cap, not just `path`. Both are attacker-supplied and
#: both are part of the same dict key, so capping one leaves the product
#: unbounded — measured at 50k distinct callers: 9 MB retained and a single
#: 1.5 MB log line, which is exactly the flood the rollup exists to prevent,
#: delivered as one line instead of many.
_MAX_LABEL_LEN = 48
_MAX_TRACKED_PATHS = 50
_MAX_TRACKED_CALLERS = 50
_MAX_REJECTED_FINGERPRINTS = 10
_MAX_ECHOED_REQUEST_ID = 64
_LABEL_SAFE = re.compile(r"[^A-Za-z0-9._/-]")
_OTHER = "<other>"

OUTCOME_KEYED = "keyed"
OUTCOME_ABSENT = "absent"
OUTCOME_INVALID = "invalid"
OUTCOME_UNCONFIGURED = "unconfigured"

_TRUTHY = {"1", "true", "yes", "on"}


def configure_service_logger(target: logging.Logger) -> None:
    """Give ONE named logger a handler and an INFO level, and nothing else one.

    Extracted from :func:`configure_auth_logging` when a second module needed
    the same treatment and did not get it: ``bazi_engine.observability`` emitted
    its "Sentry initialised" line at INFO into a logger with no handler and no
    level, so it inherited root's WARNING and the line — the documented way to
    confirm Ob3 is on — could never appear. Any future named logger in this
    service must call this, or its INFO output silently goes nowhere.
    """
    # Level FIRST, and unconditionally. Returning early on an existing handler
    # used to skip it, leaving the logger at NOTSET → inheriting root's WARNING →
    # the INFO all-clear rollups silently dropped while only the alarming ones
    # appeared. A signal that goes missing in exactly one direction is worse than
    # no signal.
    target.setLevel(logging.INFO)
    if target.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    target.addHandler(handler)


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
    configure_service_logger(logger)


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def load_engine_keys() -> List[str]:
    """Accepted keys, in order. Empty list ⇒ the engine cannot authenticate.

    Only ``ENGINE_KEYS`` is comma-separated. ``ENGINE_KEY`` is taken whole: it is
    ONE secret, and splitting it would turn a key that happens to contain a comma
    into several shorter fragments, each of which independently authenticates.
    """
    plural = _env("ENGINE_KEYS")
    if plural:
        return [k for k in (part.strip() for part in plural.split(",")) if k]
    single = _env("ENGINE_KEY")
    return [single] if single else []


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
        self._callers: set = set()
        self._fingerprints: Dict[str, int] = {}
        self._fingerprints_approximate = False
        self._window_started = time.monotonic()

    def record(
        self,
        outcome: str,
        path: str,
        caller: str,
        rejected_fingerprint: Optional[str] = None,
        reserved_path: bool = False,
    ) -> None:
        """Tally one request.

        ``reserved_path`` marks a path the engine actually routes. Those are
        never displaced by the cap: the middleware runs BEFORE the router, so 50
        requests to invented 404 paths would otherwise fill the table and push
        every real endpoint into ``<other>`` — which makes B3-b's gate ("every
        endpoint saw a keyed request") unevaluable for the price of a trivial
        unauthenticated scan.
        """
        safe_path = _label(path, "/")
        safe_caller = _label(caller, "unknown")
        with self._lock:
            if not reserved_path and safe_path not in self._paths:
                if len(self._paths) >= _MAX_TRACKED_PATHS:
                    safe_path = _OTHER
                else:
                    self._paths.add(safe_path)
            # `caller` is as attacker-controlled as `path` and shares the dict
            # key, so it needs its own cap — otherwise the pair is unbounded.
            if safe_caller not in self._callers:
                if len(self._callers) >= _MAX_TRACKED_CALLERS:
                    safe_caller = _OTHER
                else:
                    self._callers.add(safe_caller)
            key = (outcome, safe_path, safe_caller)
            self._counts[key] = self._counts.get(key, 0) + 1
            if rejected_fingerprint:
                self._record_fingerprint(rejected_fingerprint)

    def _record_fingerprint(self, fingerprint: str) -> None:
        """Bounded frequency tracking that keeps the REPEAT OFFENDER.

        Caller must hold the lock.

        The question fingerprints exist to answer is "one drifted service
        resending a stale key, or a scanner spraying junk?" — and a plain
        fixed-size table answers it backwards: whichever keys arrive FIRST take
        the slots, so a scanner filling the table makes the drifted caller
        invisible no matter how many times it retries. Gating the insertion
        instead of the increment only helps if the repeat offender happens to be
        seen first, which is exactly what an attacker controls.

        This is Space-Saving: when full, the lowest-count entry is evicted and
        the newcomer inherits its count. A key that keeps recurring climbs above
        the noise within a few hits, while memory stays capped at N entries.

        ⚠️ Once the table has overflowed, counts are an UPPER BOUND (a newcomer
        inherits the evicted count), not an exact tally. `approximate` says so in
        the payload — this is a triage signal, never an audit trail.
        """
        if fingerprint in self._fingerprints:
            self._fingerprints[fingerprint] += 1
            return
        if len(self._fingerprints) < _MAX_REJECTED_FINGERPRINTS:
            self._fingerprints[fingerprint] = 1
            return
        victim = min(self._fingerprints, key=self._fingerprints.__getitem__)
        inherited = self._fingerprints.pop(victim)
        self._fingerprints[fingerprint] = inherited + 1
        self._fingerprints_approximate = True

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
            self._callers = set()
            approximate = self._fingerprints_approximate
            self._fingerprints = {}
            self._fingerprints_approximate = False
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
            **({"rejected_key_fingerprints_approximate": True} if approximate else {}),
        }


def _emit(payload: Dict[str, Any]) -> None:
    """One greppable line. ``ENGINE-AUTH-ROLLUP`` is the Railway-log search term."""
    totals = payload["totals"]
    unconfigured = totals.get(OUTCOME_UNCONFIGURED, 0)
    if unconfigured:
        # ⚠️ The most dangerous state, and the one that used to look routine.
        # With no keys set the middleware cannot inspect the presented value at
        # all, so a correctly-keyed caller and a completely unkeyed one both land
        # here — `keyed` stays 0 forever. An operator grepping for the WARNING
        # line and finding none would read that as "no unkeyed callers, safe to
        # flip", when in fact flipping is a total outage (unconfigured fails
        # closed). The window is not evidence; say so in the line itself.
        payload["warning"] = (
            "ENGINE_KEYS/ENGINE_KEY is unset — this window proves nothing about "
            "caller coverage, and enforcing now would reject every request"
        )
    unkeyed = totals.get(OUTCOME_ABSENT, 0) + totals.get(OUTCOME_INVALID, 0) + unconfigured
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
        self._routed_paths: Optional[frozenset] = None

    def _known_paths(self, scope: Dict[str, Any]) -> frozenset:
        """The paths this app actually routes, read once from the ASGI scope.

        Derived at request time rather than passed in, because ``add_middleware``
        runs before the route decorators — there is nothing to pass at
        construction. Used only to protect real endpoints from the path cap.
        """
        if self._routed_paths is None:
            paths = set()
            for route in getattr(scope.get("app"), "routes", None) or []:
                candidate = getattr(route, "path", None)
                if isinstance(candidate, str):
                    paths.add(candidate)
            self._routed_paths = frozenset(paths)
        return self._routed_paths

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            # Websockets and lifespan pass through unchecked. There are no
            # websocket routes today (`grep '@app.websocket'` → 0); the day one
            # is added it is silently unauthenticated AND invisible to the
            # counter, so this branch must be revisited then.
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        # Trailing slash stripped before the exemption test: this runs before the
        # router, so FastAPI's own `/health/` → `/health` redirect has not
        # happened. A healthcheck configured with a slash would otherwise be
        # counted, and 401'd once enforcing — the exact failure the exemption
        # exists to prevent.
        if (path.rstrip("/") or "/") in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        outcome = OUTCOME_ABSENT
        request_id = ""
        try:
            headers = Headers(scope=scope)
            request_id = headers.get(REQUEST_ID_HEADER) or ""
            caller = headers.get(CALLER_HEADER) or "unknown"
            presented = (headers.get(ENGINE_KEY_HEADER) or "").strip()
            accepted = load_engine_keys()
            fingerprint: Optional[str] = None
            if not accepted:
                outcome = OUTCOME_UNCONFIGURED
            elif not presented:
                outcome = OUTCOME_ABSENT
            elif match_key(presented, accepted):
                outcome = OUTCOME_KEYED
            else:
                outcome = OUTCOME_INVALID
                fingerprint = fingerprint_rejected_key(presented)
            self.counter.record(
                outcome, path, caller, fingerprint, reserved_path=path in self._known_paths(scope)
            )
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
            #
            # `request_id` is read inside the try above and sanitised here — it
            # is caller-supplied and it LEAVES the process, so it gets the same
            # treatment as every other attacker-controlled string in this file.
            # (Re-parsing the headers at this point would also put an unguarded
            # parse on the path reached by the `except` branch, whose cause may
            # have been that very parse failing.)
            echoed = _label(request_id, "")[:_MAX_ECHOED_REQUEST_ID]
            response = JSONResponse(
                status_code=401,
                content={"detail": "Engine authentication required."},
                headers={REQUEST_ID_HEADER: echoed} if echoed else None,
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
