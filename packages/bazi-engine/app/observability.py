"""Ob3 — Sentry for the Bazi engine, with the birth data left behind.

This is the engine's FIRST error reporting of any kind. Until now an engine
exception produced a stack trace in Railway's log stream and nothing else: no
grouping, no frequency, no correlation with the API request that caused it.

⚠️ THE ENGINE IS THE WORST PLACE IN THIS SYSTEM TO ENABLE SENTRY CARELESSLY.

Every request to this service is birth data — date, time, city, coordinates,
gender — and the module-level functions it calls are pure transforms OF that
data. So at the moment an exception is raised, the local variables in every
frame on the stack are the user's birth information, and the four pillars
derived from it. A default `sentry_sdk.init(dsn=...)` would ship all of it.

Four controls, three of them SDK switches and one enforced here regardless:

1. ``send_default_pii=False`` — the SDK's own intent switch.
2. ``max_request_body_size="never"`` — the request body IS the birth data.
3. ``include_local_variables=False`` — the one that is specific to this service.
   Stack locals are the default-on feature that would defeat the other two.
4. ``before_send`` / ``before_send_transaction`` — because 1–3 depend on SDK
   behaviour that has changed across major versions, and "I read the SDK source
   once" is not a control that survives an upgrade.

The fourth also covers something the first three cannot: **the exception
message**. Pydantic raises ``ValidationError`` with the offending input embedded
in the text, and FastAPI turns a bad birth payload into exactly that. The
message is also Sentry's grouping key and the most visible field in the UI.

⚠️ KEEP IN SYNC with ``apps/api/src/common/sentry-scrub.ts``. The two are
deliberately separate implementations — this side must run without Node, and the
key sets are not identical because each service emits different field names —
but the TS list is the canonical one and this must remain a SUPERSET of it.
``tests/test_observability.py`` asserts that by parsing the TS file.

Env:
    ``SENTRY_DSN_ENGINE``   its own project, deliberately NOT ``SENTRY_DSN``.
                            One name shared with the API invites someone to set
                            the API's DSN here, which silently merges two
                            services with very different PII profiles into one
                            project. Unset ⇒ Sentry is off, which is the correct
                            default for local development.
    ``SENTRY_TRACES_SAMPLE_RATE``  explicit; see :func:`_traces_sample_rate`.
    ``ENGINE_ENV`` / ``RAILWAY_ENVIRONMENT``  environment label.
"""

from __future__ import annotations

import logging
import os
import re
from contextvars import ContextVar
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("bazi_engine.observability")

#: Set by :func:`init_sentry`. Read by the middleware so a request pays nothing
#: at all when Sentry is off — the default locally and in tests.
_sentry_enabled = False


def sentry_enabled() -> bool:
    return _sentry_enabled

REDACTED = "[redacted:pii]"

#: Keys whose VALUE is personal data wherever it appears, at any depth.
#: Compared case-insensitively against the exact key name.
PII_KEYS = frozenset(
    k.lower()
    for k in (
        # Birth data — the engine's entire input surface.
        "birth_date", "birth_time", "birth_city", "birth_timezone",
        "birth_longitude", "birth_latitude", "birthdate", "birthtime",
        "birthcity", "birthtimezone", "birthlongitude", "birthlatitude",
        "lunarbirthdate", "lunar_birth_date", "lunardate", "lunar_date",
        "profilebirthdate", "profilebirthtime",
        # Individually 1-of-60; they arrive as a set of four.
        "yearganzhi", "monthganzhi", "dayganzhi", "hourganzhi",
        "year_ganzhi", "month_ganzhi", "day_ganzhi", "hour_ganzhi",
        # Identity / identity-adjacent.
        "email", "email_address", "emailaddress", "phone", "phonenumber",
        "gender", "name", "questiontext", "question_text", "content",
        "devicefingerprint", "device_fingerprint",
        # Credentials.
        "authorization", "cookie", "token", "accesstoken", "access_token",
        "apikey", "api_key", "engine_key", "x-engine-key", "secret", "password",
        # ZWDS shapes: solarDate + timeRange together are the birth datetime.
        "solardate", "solar_date", "timerange", "time_range", "targetday",
        "target_day", "target_date",
    )
)

#: Keys whose whole SUBTREE is dropped. Containers, not leaf keys — redacting
#: pillar fields one at a time invites a future sibling being added and missed,
#: which is exactly how ``ganZhi`` (a SECOND copy of all four pillars) survived
#: the first version of the TS scrubber.
PII_SUBTREE_KEYS = frozenset(
    k.lower()
    for k in (
        "fourpillars", "four_pillars", "pillars",
        "yearpillar", "monthpillar", "daypillar", "hourpillar",
        "year_pillar", "month_pillar", "day_pillar", "hour_pillar",
        "ganzhi", "gan_zhi",
        "chart", "chartdata", "chart_data", "chartcontext", "chart_context",
        "charta", "chartb", "chart_a", "chart_b",
        "natalchart", "natal_chart", "luckperiods", "luck_periods",
        "annualstars", "annual_stars", "truesolartime", "true_solar_time",
        "calculationdata", "calculation_data", "calculationjson",
        "calculation_json", "aiinterpretation", "ai_interpretation",
        "interpretationjson", "interpretation_json",
        "engineoutput", "engineoutputjson", "engine_output", "engine_output_json",
        "ainarrativejson", "ai_narrative_json", "narrative",
        "birthprofile", "birth_profile", "birth_data", "birthdata",
        "party_a", "party_b", "person_a", "person_b",
    )
)

_MAX_DEPTH = 8

#: Cap on a Sentry tag value. Both tags come from attacker-supplied headers, and
#: an unbounded tag value is a log-size and index-cardinality attack — the same
#: reasoning as ``engine_auth``'s label caps.
_MAX_TAG_LEN = 64

#: Free-text shapes. Mirrors ``redactFreeText`` in the TS scrubber — necessarily
#: pattern-based, so deliberately conservative: it targets what this product
#: actually leaks into error text rather than pretending to catch prose.
_FREE_TEXT_PATTERNS = (
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),                       # ISO birth dates
    re.compile(r"\b([01]?\d|2[0-3]):[0-5]\d\b"),                # HH:MM
    re.compile(r"[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]"),  # any 干支 pair
    re.compile(r"\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),  # JWT
    re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b"),                # email
)


#: The values THIS request was given, so free text can be scrubbed by value
#: rather than only by shape. A ``ContextVar`` because it must not leak between
#: concurrent requests — and the engine now runs a threadpool (M3), so a plain
#: module global would cross-contaminate under exactly the load where an
#: exception is most likely.
_request_pii_values: "ContextVar[Tuple[str, ...]]" = ContextVar(
    "bazi_engine_request_pii", default=()
)

#: ⚠️ TWO, not three. The first version used 3 — a floor calibrated for Latin
#: text, where two characters really is noise — and it silently failed to
#: register ``吉打``. Most Chinese city names are exactly two characters (台北,
#: 高雄, 北京), so a 3-char floor excludes the single field this value-based
#: redaction exists for, while every other birth field (a 10-char date, a 5-char
#: time, an IANA zone) sails over either floor. Caught by the acceptance test,
#: not by review.
#:
#: One character stays excluded: no birth field is legitimately 1 char, and a
#: lone CJK character is a stem or branch that would shred 干支 diagnostics.
_MIN_VALUE_LEN = 2

#: Bounds what one request can register. Values come from a validated model with
#: a fixed field list, so this is a backstop rather than a live concern.
_MAX_VALUES = 16


def register_sensitive_values(*values: Any) -> None:
    """Declare that these exact strings are this request's personal data.

    ## Why value-based redaction exists alongside the patterns

    ``redact_free_text`` catches SHAPES — an ISO date, an ``HH:MM``, a 干支 pair.
    It cannot catch a city name: ``吉打`` is indistinguishable from any other
    Chinese text, and a rule broad enough to catch it (redact all CJK) would
    delete the diagnosis along with the data.

    So the shape patterns are a floor, not the control. The control is knowing
    what we were actually handed. Registered at model-validation time — the one
    moment the values are known and structured — every later free-text scrub can
    remove them exactly, whatever string some future ``f"..."`` interpolates them
    into. It generalises to fields nobody has thought to pattern-match yet, which
    is the property a PII control needs.

    A no-op on anything short, non-string, or beyond the cap.
    """
    seen = list(_request_pii_values.get())
    for value in values:
        if not isinstance(value, str):
            continue
        candidate = value.strip()
        if len(candidate) < _MIN_VALUE_LEN or candidate in seen:
            continue
        seen.append(candidate)
        if len(seen) >= _MAX_VALUES:
            break
    # Longest first: redacting "Asia" before "Asia/Taipei" would leave "/Taipei"
    # behind, which still names the city.
    _request_pii_values.set(tuple(sorted(seen, key=len, reverse=True)))


def clear_sensitive_values() -> None:
    """Tests only — a ContextVar set inside a request is discarded with it."""
    _request_pii_values.set(())


def redact_free_text(text: str) -> str:
    """Redact PII inside a string we cannot reason about structurally.

    Values first, then shapes: a registered value is an exact known leak, and
    removing it before the patterns run avoids a partial match leaving a
    recognisable fragment.
    """
    for value in _request_pii_values.get():
        if value in text:
            text = text.replace(value, REDACTED)
    for pattern in _FREE_TEXT_PATTERNS:
        text = pattern.sub(REDACTED, text)
    return text


def scrub_value(value: Any, depth: int = 0) -> Any:
    """Recursively redact. Returns a new value; never mutates the input."""
    if depth > _MAX_DEPTH:
        return value
    if isinstance(value, dict):
        out: Dict[Any, Any] = {}
        for key, v in value.items():
            k = key.lower() if isinstance(key, str) else key
            if k in PII_SUBTREE_KEYS or k in PII_KEYS:
                out[key] = REDACTED
            else:
                out[key] = scrub_value(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        scrubbed = [scrub_value(v, depth + 1) for v in value]
        return type(value)(scrubbed) if isinstance(value, tuple) else scrubbed
    if isinstance(value, str):
        return redact_free_text(value)
    return value


def scrub_event(event: Dict[str, Any], _hint: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """``before_send`` hook. Returns a NEW event.

    Deliberately whole-event rather than field-by-field: the engine's payload
    can surface in ``request``, ``extra``, ``contexts``, ``breadcrumbs`` or span
    data depending on which integration attached it, and enumerating the ones we
    happened to think of is how the TS version initially let transactions leak a
    query string that the error path redacted.
    """
    try:
        scrubbed = scrub_value(event)
    except Exception:  # noqa: BLE001 — a scrubber that throws must not send the raw event
        logger.exception("Sentry scrub failed — dropping the event rather than sending it raw")
        return {}

    # Drop the request body outright rather than walking it. It is the birth
    # payload in full and is never worth the risk of a key we did not list.
    request = scrubbed.get("request")
    if isinstance(request, dict):
        for field in ("data", "cookies", "query_string"):
            if field in request:
                request[field] = REDACTED

    # Keep `id` — the whole point of attaching a user — and drop the rest.
    user = scrubbed.get("user")
    if isinstance(user, dict):
        scrubbed["user"] = {"id": user["id"]} if "id" in user else {}

    return scrubbed


def _traces_sample_rate() -> float:
    """Explicit, because the SDK's default is ``None`` — meaning NO SPANS AT ALL.

    Ob3's acceptance is "trace shows spans". Leaving this unset produces an
    integration that reports errors perfectly and silently never traces
    anything, which looks like success until someone opens the performance tab.
    """
    raw = os.environ.get("SENTRY_TRACES_SAMPLE_RATE")
    if raw is not None:
        try:
            value = float(raw)
            if 0.0 <= value <= 1.0:
                return value
            logger.warning("SENTRY_TRACES_SAMPLE_RATE=%s out of [0,1] — using default", raw)
        except ValueError:
            logger.warning("SENTRY_TRACES_SAMPLE_RATE=%s is not a number — using default", raw)
    from .engine_auth import is_production

    return 0.2 if is_production() else 1.0


def sentry_dsn() -> Optional[str]:
    dsn = (os.environ.get("SENTRY_DSN_ENGINE") or "").strip()
    return dsn or None


def init_sentry() -> bool:
    """Initialise Sentry. Returns whether it was enabled.

    A no-op without ``SENTRY_DSN_ENGINE``, and a no-op — with a warning — if the
    SDK is not installed, so a missing dependency degrades to "no telemetry"
    rather than refusing to boot the calculation engine.
    """
    global _sentry_enabled
    _sentry_enabled = False

    dsn = sentry_dsn()
    if not dsn:
        logger.info("SENTRY_DSN_ENGINE not set — engine error reporting is OFF")
        return False

    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN_ENGINE is set but sentry-sdk is not installed — skipping")
        return False

    from .engine_auth import is_production

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("ENGINE_ENV")
        or os.environ.get("RAILWAY_ENVIRONMENT")
        or ("production" if is_production() else "development"),
        traces_sample_rate=_traces_sample_rate(),
        # (1) intent, (2) the request body, (3) THE STACK LOCALS — see the
        # module docblock. All three are load-bearing; none is redundant.
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
    )
    _sentry_enabled = True
    logger.info("Sentry initialised for bazi-engine (traces=%.2f)", _traces_sample_rate())
    return True


def tag_request(request_id: Optional[str], caller: Optional[str]) -> None:
    """Correlate this engine event with the API request that caused it.

    ``engineFetch`` on the NestJS side has always sent ``X-Request-Id``, and the
    engine has always ignored it — the header existed with nothing reading it.
    Tagging makes an engine error findable from the API error that reported it,
    which is the difference between "the engine 500s sometimes" and a specific
    reproducible call.

    Safe to call when Sentry is off: ``set_tag`` on an uninitialised SDK is a
    no-op, and the import failure is caught.
    """
    # ⚠️ No per-request `import`, and nothing at all when Sentry is off.
    #
    # This runs on EVERY engine request, and the service's whole performance
    # argument is a ~3ms median. An `import` inside the function is a cheap
    # `sys.modules` hit when the package is present — but raises and constructs
    # an ImportError on every single request when it is not, which is the local
    # and CI default. And with no DSN configured, `set_tag` would still walk the
    # SDK's scope machinery to do nothing.
    if not _sentry_enabled:
        return
    try:
        import sentry_sdk  # cached in sys.modules; init already imported it

        if request_id:
            sentry_sdk.set_tag("request_id", request_id[:_MAX_TAG_LEN])
        if caller:
            sentry_sdk.set_tag("engine_caller", caller[:_MAX_TAG_LEN])
    except Exception:  # noqa: BLE001 — telemetry must never break a calculation
        logger.debug("Failed to tag Sentry scope", exc_info=True)



class SentryRequestTagMiddleware:
    """Pure-ASGI (not ``BaseHTTPMiddleware``), for the same reason as
    :class:`~app.engine_auth.EngineKeyMiddleware`: this service's argument is a
    ~3ms median and the work here is reading two headers. ``BaseHTTPMiddleware``
    would wrap every request in an anyio task group and cost more than the work.

    ⚠️ Must be registered so it runs INSIDE Sentry's own ASGI integration —
    which, since the integration is installed by ``sentry_sdk.init`` and wraps
    the whole app, means anywhere in the normal middleware stack. The scope it
    tags is the per-request isolation scope that integration creates; without
    Sentry initialised, ``set_tag`` is a no-op and this is two dict lookups.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Dict[str, Any], receive: Any, send: Any) -> None:
        if _sentry_enabled and scope.get("type") == "http":
            headers = {k.lower(): v for k, v in scope.get("headers") or []}
            tag_request(
                _decode(headers.get(b"x-request-id")),
                _decode(headers.get(b"x-engine-caller")),
            )
        await self.app(scope, receive, send)


def _decode(raw: Optional[bytes]) -> Optional[str]:
    if not raw:
        return None
    try:
        return raw.decode("latin-1")
    except Exception:  # noqa: BLE001
        return None
