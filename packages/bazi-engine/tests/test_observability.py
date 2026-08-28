"""Ob3 — the engine's Sentry integration must not ship birth data.

The important tests here are NOT of ``scrub_event`` in isolation. They drive a
REAL ``sentry_sdk`` through a real FastAPI request and inspect the SERIALIZED
envelope, because the failure mode is a field some integration attaches that a
hand-built fixture would never contain — which is exactly how the sibling TS
scrubber initially let ``ganZhi`` and a transaction's span data through while
its unit tests were green.
"""

from __future__ import annotations

import json
import pathlib
import re

import pytest

from app import observability
from app.observability import (
    PII_KEYS,
    PII_SUBTREE_KEYS,
    REDACTED,
    redact_free_text,
    scrub_event,
)

@pytest.fixture(autouse=True)
def _isolate_sentry_state():
    """Undo the global state these tests install.

    Several of them call the REAL ``sentry_sdk.init``. That leaves a live client
    and ``observability._sentry_enabled = True`` behind for every later test in
    the process — including tests in other files, which would then take the
    Sentry path without asking for it. Cheap to prevent, tedious to diagnose.
    """
    yield
    import sentry_sdk

    sentry_sdk.init(dsn=None)
    observability._sentry_enabled = False
    observability.clear_sensitive_values()


# The calibration anchor, so a leak is recognisable rather than abstract.
ROGER = {
    "birth_date": "1987-09-06",
    "birth_time": "16:11",
    "birth_city": "吉打",
    "birth_timezone": "Asia/Kuala_Lumpur",
    "gender": "male",
}
#: Every substring whose presence in an event is a reportable data leak.
LEAK_MARKERS = ["1987-09-06", "16:11", "吉打", "戊午", "丁卯", "戊申"]


# ============================================================
# The two-part acceptance test (plan Ob3)
# ============================================================

def _capturing_client(monkeypatch):
    """Init the real SDK against an in-memory transport and return the app."""
    import sentry_sdk
    from fastapi.testclient import TestClient

    captured: list[dict] = []

    class Capture(sentry_sdk.transport.Transport):
        def capture_envelope(self, envelope):  # noqa: D102
            for item in envelope.items:
                payload = item.get_event() or item.payload.json
                if payload:
                    captured.append(payload)

        def capture_event(self, event):  # noqa: D102
            captured.append(event)

    monkeypatch.setenv("SENTRY_DSN_ENGINE", "https://public@example.invalid/1")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")

    # Same call the engine makes at import time, but with our transport bolted
    # on — so what we assert against is what `init_sentry` configures, not a
    # separate hand-rolled init that could drift from it.
    real_init = sentry_sdk.init

    def init_with_capture(**kwargs):
        return real_init(**{**kwargs, "transport": Capture()})

    monkeypatch.setattr(sentry_sdk, "init", init_with_capture)
    assert observability.init_sentry() is True

    from app import main

    return TestClient(main.app, raise_server_exceptions=False), captured


def test_forced_exception_ships_no_birth_data(monkeypatch):
    """Part 1 — no birth values anywhere in the serialized event."""
    from app import main

    # A message carrying the payload, mirroring the real leak shape: pydantic's
    # ValidationError and Prisma's ValidationError both embed the offending
    # input in the exception text, which is also Sentry's grouping key.
    def boom(**kwargs):
        raise RuntimeError(
            f"engine failed for {kwargs['birth_date']} {kwargs['birth_time']} "
            f"{kwargs['birth_city']} — pillars 丁卯 戊申 戊午"
        )

    client, captured = _capturing_client(monkeypatch)
    monkeypatch.setattr(main, "calculate_bazi", boom)

    resp = client.post("/calculate", json=ROGER, headers={"X-Request-Id": "req-abc-123"})
    assert resp.status_code >= 500

    errors = [e for e in captured if e.get("type") != "transaction" and e.get("exception")]
    assert errors, "the SDK captured no error event — the test proves nothing"

    serialized = json.dumps(errors, ensure_ascii=False, default=str)
    for marker in LEAK_MARKERS:
        assert marker not in serialized, f"{marker!r} leaked into the Sentry event"
    # The timezone is a coarse location and travels with the rest of the payload.
    assert "Asia/Kuala_Lumpur" not in serialized


def test_the_event_is_still_worth_having(monkeypatch):
    """Part 2 — redaction that removes the diagnosis is not a win.

    A scrubber that returns ``{}`` passes part 1 perfectly and makes the whole
    integration pointless, so the useful half has to be asserted too.
    """
    from app import main

    def boom(**_kwargs):
        raise RuntimeError("engine failed for 1987-09-06 16:11 吉打")

    client, captured = _capturing_client(monkeypatch)
    monkeypatch.setattr(main, "calculate_bazi", boom)
    client.post("/calculate", json=ROGER, headers={"X-Request-Id": "req-abc-123"})

    errors = [e for e in captured if e.get("type") != "transaction" and e.get("exception")]
    assert errors
    event = errors[0]
    blob = json.dumps(event, ensure_ascii=False, default=str)

    # The exception type — without it there is nothing to group on.
    assert "RuntimeError" in blob
    # A stack, pointing at our code.
    assert "main" in blob and "calculate_bazi_endpoint" in blob
    # The route, so you know WHICH endpoint broke.
    assert "/calculate" in blob
    # And the correlation tag that makes this findable from the API's own error.
    assert event.get("tags", {}).get("request_id") == "req-abc-123"


def test_stack_locals_are_never_attached(monkeypatch):
    """The control specific to this service.

    Every frame on an engine stack holds the birth payload in its locals, so
    ``include_local_variables=False`` is doing more work here than anywhere else
    in the system. Asserted structurally, not by absence of a string: a `vars`
    key present but empty would still be a regression waiting to happen.
    """
    from app import main

    def boom(**_kwargs):
        raise RuntimeError("plain message, no payload")

    client, captured = _capturing_client(monkeypatch)
    monkeypatch.setattr(main, "calculate_bazi", boom)
    client.post("/calculate", json=ROGER)

    errors = [e for e in captured if e.get("type") != "transaction" and e.get("exception")]
    assert errors
    frames = [
        f
        for e in errors
        for v in e.get("exception", {}).get("values", [])
        for f in (v.get("stacktrace") or {}).get("frames", [])
    ]
    assert frames, "no frames captured — the assertion below would be vacuous"
    assert all("vars" not in f for f in frames), "stack locals were attached"


def test_request_body_is_never_attached(monkeypatch):
    from app import main

    def boom(**_kwargs):
        raise RuntimeError("plain message, no payload")

    client, captured = _capturing_client(monkeypatch)
    monkeypatch.setattr(main, "calculate_bazi", boom)
    client.post("/calculate", json=ROGER)

    for event in captured:
        data = (event.get("request") or {}).get("data")
        assert data in (None, REDACTED), f"request body attached: {data!r}"


# ============================================================
# Unit-level properties
# ============================================================

def test_scrub_drops_pillar_containers_not_just_leaf_keys():
    # `ganZhi` is a SECOND copy of all four pillars emitted alongside
    # `fourPillars`. Dropping one while the sibling sails through is the exact
    # bug the TS scrubber shipped once.
    event = {
        "extra": {
            "fourPillars": {"year": "丁卯"},
            "ganZhi": {"year": "丁卯", "month": "戊申"},
            "dayMasterStem": "戊",
        }
    }
    out = scrub_event(event)
    assert out["extra"]["fourPillars"] == REDACTED
    assert out["extra"]["ganZhi"] == REDACTED
    # A single 1-of-10 field is not identifying and stays — over-redaction that
    # removes the diagnosis is its own failure.
    assert out["extra"]["dayMasterStem"] == "戊"


def test_scrub_reaches_nested_and_listed_values():
    event = {"contexts": {"trace": {"data": [{"birth_date": "1987-09-06"}]}}}
    assert scrub_event(event)["contexts"]["trace"]["data"][0]["birth_date"] == REDACTED


def test_scrub_keeps_only_the_user_id():
    out = scrub_event({"user": {"id": "u-1", "email": "a@b.com", "ip_address": "1.2.3.4"}})
    assert out["user"] == {"id": "u-1"}


def test_scrub_never_mutates_the_caller_event():
    # Sentry reuses the event object; a mutation would leak redaction back into
    # application state.
    event = {"extra": {"birth_date": "1987-09-06"}}
    scrub_event(event)
    assert event["extra"]["birth_date"] == "1987-09-06"


def test_scrub_drops_the_event_rather_than_sending_it_raw_on_failure(monkeypatch):
    monkeypatch.setattr(
        observability, "scrub_value", lambda *_a, **_k: (_ for _ in ()).throw(ValueError("x"))
    )
    assert scrub_event({"extra": {"birth_date": "1987-09-06"}}) == {}


@pytest.mark.parametrize(
    "text,marker",
    [
        ("born 1987-09-06", "1987-09-06"),
        ("at 16:11 local", "16:11"),
        ("day pillar 戊午", "戊午"),
        ("mail me at a.b@example.com", "a.b@example.com"),
        ("token eyJhbGciOiJIUzI1.abc.def", "eyJhbGciOiJIUzI1"),
    ],
)
def test_free_text_shapes_are_redacted(text, marker):
    assert marker not in redact_free_text(text)


def test_traces_sample_rate_is_explicit(monkeypatch):
    # Unset it and the SDK defaults to None — errors report perfectly and no
    # span is ever recorded, which looks like success until Ob3's own acceptance
    # ("trace shows spans") is checked.
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.35")
    assert observability._traces_sample_rate() == 0.35
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "banana")
    assert 0.0 < observability._traces_sample_rate() <= 1.0
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "7")
    assert 0.0 < observability._traces_sample_rate() <= 1.0
    monkeypatch.delenv("SENTRY_TRACES_SAMPLE_RATE")
    assert 0.0 < observability._traces_sample_rate() <= 1.0


def test_init_is_a_no_op_without_a_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN_ENGINE", raising=False)
    assert observability.init_sentry() is False
    monkeypatch.setenv("SENTRY_DSN_ENGINE", "   ")
    assert observability.init_sentry() is False


def test_dsn_is_its_own_variable(monkeypatch):
    # Sharing `SENTRY_DSN` with the API invites someone setting the API's DSN
    # here, merging two services with very different PII profiles into one
    # project — where the engine's stricter scrubbing would not apply.
    monkeypatch.delenv("SENTRY_DSN_ENGINE", raising=False)
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/9")
    assert observability.sentry_dsn() is None


def test_tag_request_bounds_attacker_supplied_values(monkeypatch):
    import sentry_sdk

    # ⚠️ Enable explicitly. `tag_request` short-circuits when Sentry is off, so
    # without this the loop below iterates ZERO tags and the assertion passes
    # while proving nothing — which is exactly how this test first shipped.
    monkeypatch.setattr(observability, "_sentry_enabled", True)

    with sentry_sdk.isolation_scope() as scope:
        observability.tag_request("x" * 500, "y" * 500)
        assert set(scope._tags) == {"request_id", "engine_caller"}, "no tags were set"
        for value in scope._tags.values():
            assert len(value) <= 64


def test_tag_request_does_nothing_when_sentry_is_off(monkeypatch):
    """The engine's median is ~3ms and this runs on every request.

    With no DSN configured there is no scope worth touching, and calling into
    the SDK to do nothing still walks its scope machinery.
    """
    import sentry_sdk

    monkeypatch.setattr(observability, "_sentry_enabled", False)
    with sentry_sdk.isolation_scope() as scope:
        observability.tag_request("req-1", "bazi.reading")
        assert scope._tags == {}


def test_middleware_skips_header_parsing_when_sentry_is_off(monkeypatch):
    called: list = []
    monkeypatch.setattr(observability, "_sentry_enabled", False)
    monkeypatch.setattr(observability, "tag_request", lambda *a: called.append(a))

    import asyncio

    async def downstream(_scope, _receive, _send):
        return None

    mw = observability.SentryRequestTagMiddleware(downstream)
    asyncio.run(mw({"type": "http", "headers": [(b"x-request-id", b"r1")]}, None, None))
    assert called == []


# ============================================================
# Cross-language parity with the canonical TS list
# ============================================================

def test_python_key_set_is_a_superset_of_the_typescript_one():
    """The TS scrubber is canonical; this side must not be laxer.

    A key gets added to the TS list because someone found a leak. If the engine
    — which PRODUCES most of those field names — does not learn about it, the
    same value keeps shipping from the service closest to the data.
    """
    ts = (
        pathlib.Path(__file__).resolve().parents[3]
        / "apps" / "api" / "src" / "common" / "sentry-scrub.ts"
    )
    assert ts.exists(), f"canonical scrubber not found at {ts}"
    # Strip line comments first: the prose in that file contains apostrophes
    # ("the docblock's own argument"), and a naive quote scan reads them as
    # string delimiters and yields fragments of English as "keys".
    source = re.sub(r"//[^\n]*", "", ts.read_text(encoding="utf-8"))

    def keys_of(const_name: str) -> set[str]:
        block = re.search(
            rf"const {const_name} = new Set\(\s*\[(.*?)\]\.map", source, re.S
        )
        assert block, f"could not parse {const_name} from {ts.name}"
        return {m.lower() for m in re.findall(r"'([^']+)'", block.group(1))}

    ts_keys = keys_of("PII_KEYS")
    ts_subtrees = keys_of("PII_SUBTREE_KEYS")
    # Guard the guard: a parse that silently found nothing would pass vacuously.
    assert len(ts_keys) > 20 and len(ts_subtrees) > 10

    ours = PII_KEYS | PII_SUBTREE_KEYS
    missing = (ts_keys | ts_subtrees) - ours
    assert not missing, (
        "keys the TS scrubber redacts and this one does not: "
        f"{sorted(missing)}. Add them to observability.py."
    )


# ============================================================
# Value-based redaction (the control the acceptance test forced into existence)
# ============================================================

def test_a_two_character_cjk_city_is_registered():
    """The regression that shipped in the first draft.

    A 3-character floor is right for Latin noise and wrong for this product:
    most Chinese city names are exactly two characters, so the floor excluded
    the one field value-based redaction exists to catch.
    """
    from app.main import BirthDataInput

    observability.clear_sensitive_values()
    BirthDataInput(
        birth_date="1987-09-06", birth_time="16:11", birth_city="吉打",
        birth_timezone="Asia/Kuala_Lumpur", gender="male",
    )
    assert "吉打" in observability._request_pii_values.get()
    assert "吉打" not in redact_free_text("engine failed for 吉打")


def test_registration_is_automatic_for_every_birth_dto():
    """Inheritance is the guarantee, so assert on inheritance.

    Registering per-endpoint would leave the seventh DTO out. The mixin is
    already the common ancestor of all birth-data inputs (N1 established that),
    so this cannot be forgotten — unless someone adds a DTO that skips it.
    """
    from app import main
    from app.main import _HourKnownValidatedInput
    from pydantic import BaseModel
    import inspect

    dtos = [
        obj for _n, obj in inspect.getmembers(main, inspect.isclass)
        if issubclass(obj, BaseModel) and "birth_date" in getattr(obj, "model_fields", {})
    ]
    assert dtos, "no birth-data DTOs found — the assertion below would be vacuous"
    missing = [d.__name__ for d in dtos if not issubclass(d, _HourKnownValidatedInput)]
    assert not missing, (
        f"{missing} carry birth data but skip _HourKnownValidatedInput, so their "
        "values are never registered for redaction"
    )


def test_longest_value_is_redacted_first():
    # "Asia" removed before "Asia/Taipei" would leave "/Taipei" — still the city.
    observability.clear_sensitive_values()
    observability.register_sensitive_values("Asia", "Asia/Taipei")
    assert "Taipei" not in redact_free_text("tz was Asia/Taipei")


def test_registration_ignores_junk_and_is_bounded():
    observability.clear_sensitive_values()
    observability.register_sensitive_values(None, 42, "", "x", "  ")
    assert observability._request_pii_values.get() == ()
    observability.register_sensitive_values(*[f"value-{i}" for i in range(50)])
    assert len(observability._request_pii_values.get()) <= 16


def test_values_do_not_leak_between_requests():
    """A module global would cross-contaminate — and M3 put these handlers in a
    threadpool, so concurrency here is real rather than theoretical."""
    import threading

    observability.clear_sensitive_values()
    observability.register_sensitive_values("台北")
    seen: list[tuple] = []

    def other_request():
        # A fresh thread starts from an empty context, exactly as a concurrent
        # request would.
        seen.append(observability._request_pii_values.get())

    t = threading.Thread(target=other_request)
    t.start()
    t.join()
    assert seen == [()]
    assert "台北" in observability._request_pii_values.get()


# ============================================================
# The init CONFIG itself
# ============================================================

def _captured_init_kwargs(monkeypatch) -> dict:
    import sentry_sdk

    seen: dict = {}

    def fake_init(**kwargs):
        seen.update(kwargs)

    monkeypatch.setenv("SENTRY_DSN_ENGINE", "https://public@example.invalid/1")
    monkeypatch.setattr(sentry_sdk, "init", fake_init)
    assert observability.init_sentry() is True
    return seen


@pytest.mark.parametrize(
    "option,expected",
    [
        ("send_default_pii", False),
        ("max_request_body_size", "never"),
        ("include_local_variables", False),
    ],
)
def test_each_pii_switch_actually_reaches_init(monkeypatch, option, expected):
    """Assert the CONFIG, not only the outcome.

    Every one of these three was verified through an end-to-end assertion on a
    captured event — and mutation testing showed two of them could be deleted
    with the suite still green, because `before_send` independently produced the
    same outcome. Defence in depth is only depth if each layer is load-bearing
    on its own; otherwise the second layer silently becomes the only layer.
    """
    assert _captured_init_kwargs(monkeypatch)[option] == expected


def test_both_scrub_hooks_are_installed(monkeypatch):
    kwargs = _captured_init_kwargs(monkeypatch)
    # `before_send` alone leaves TRANSACTIONS unscrubbed, and tracing is on —
    # the exact gap the TS scrubber shipped once, where a query string was
    # redacted on the error path and survived as span data.
    assert kwargs["before_send"] is scrub_event
    assert kwargs["before_send_transaction"] is scrub_event


def test_traces_sample_rate_reaches_init(monkeypatch):
    # The helper was well tested and nothing asserted it was passed. Unset, the
    # SDK's default is None — no spans at all — which is indistinguishable from
    # a working integration until someone opens the performance tab.
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.42")
    assert _captured_init_kwargs(monkeypatch)["traces_sample_rate"] == 0.42


def test_the_configured_dsn_is_the_engine_one(monkeypatch):
    assert _captured_init_kwargs(monkeypatch)["dsn"] == "https://public@example.invalid/1"
