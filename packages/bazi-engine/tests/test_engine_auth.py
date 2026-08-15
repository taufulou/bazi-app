"""B3-a — engine shared-secret middleware.

Two classes of test here, deliberately:

* **Unit** tests drive a throwaway Starlette app through the middleware, so a
  broken counter or a hostile header can be injected without booting the whole
  engine.
* **Integration** tests drive the REAL ``app.main:app``, because the properties
  that matter most are properties of the WIRING — ``/health`` exempt, auth
  nested inside CORS, docs off in prod. A middleware that is correct but mounted
  in the wrong order is the failure mode this row exists to prevent.
"""

import importlib
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app import engine_auth
from app.engine_auth import (
    CALLER_HEADER,
    ENGINE_KEY_HEADER,
    OUTCOME_ABSENT,
    OUTCOME_INVALID,
    OUTCOME_KEYED,
    OUTCOME_UNCONFIGURED,
    EngineKeyMiddleware,
    RejectionCounter,
    fingerprint_rejected_key,
    flush_counter,
    is_production,
    load_engine_keys,
    match_key,
    require_key_enabled,
)

GOOD_KEY = "k" * 43
OTHER_KEY = "z" * 43

_ENGINE_ENV_VARS = (
    "ENGINE_KEY",
    "ENGINE_KEYS",
    "ENGINE_REQUIRE_KEY",
    "ENGINE_ENV",
    "RAILWAY_ENVIRONMENT",
)


@pytest.fixture(autouse=True)
def clean_engine_env(monkeypatch):
    """Every test starts from "no engine auth configured".

    Without this the developer's own shell (or a previous test) decides whether
    the middleware enforces, and the enforce tests would pass for the wrong
    reason.
    """
    for name in _ENGINE_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def build_app(counter=None):
    """Minimal app: one echo route, wrapped exactly as the engine wraps its own."""

    async def ok(_request):
        return PlainTextResponse("ok")

    inner = FastAPI(routes=[Route("/calculate", ok, methods=["POST", "GET"])])
    return EngineKeyMiddleware(inner, counter=counter)


def client(counter=None):
    return TestClient(build_app(counter))


# ============================================================
# Configuration
# ============================================================


class TestConfiguration:
    def test_no_keys_configured_yields_empty_list(self):
        assert load_engine_keys() == []

    def test_engine_keys_parses_comma_list_and_trims(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", f" {GOOD_KEY} , {OTHER_KEY} , ")
        assert load_engine_keys() == [GOOD_KEY, OTHER_KEY]

    def test_engine_key_is_the_singular_fallback(self, monkeypatch):
        # Steady state is ONE Railway shared variable referenced by both
        # services; ENGINE_KEYS exists only for the rotation window.
        monkeypatch.setenv("ENGINE_KEY", GOOD_KEY)
        assert load_engine_keys() == [GOOD_KEY]

    def test_engine_keys_wins_over_engine_key(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEY", GOOD_KEY)
        monkeypatch.setenv("ENGINE_KEYS", OTHER_KEY)
        assert load_engine_keys() == [OTHER_KEY]

    @pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
    def test_require_key_truthy_values(self, monkeypatch, raw):
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", raw)
        assert require_key_enabled() is True

    @pytest.mark.parametrize("raw", ["", "0", "false", "no", "observe", "maybe"])
    def test_require_key_defaults_to_observe(self, monkeypatch, raw):
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", raw)
        assert require_key_enabled() is False

    def test_require_key_absent_is_observe(self):
        assert require_key_enabled() is False

    @pytest.mark.parametrize(
        "env,railway,expected",
        [
            ("", "", False),
            ("", "production", True),
            ("", "staging", False),
            ("production", "", True),
            ("prod", "", True),
            ("development", "production", False),  # explicit wins
            ("staging", "production", False),
        ],
    )
    def test_is_production_matrix(self, monkeypatch, env, railway, expected):
        if env:
            monkeypatch.setenv("ENGINE_ENV", env)
        if railway:
            monkeypatch.setenv("RAILWAY_ENVIRONMENT", railway)
        assert is_production() is expected


class TestMatchKey:
    def test_exact_match(self):
        assert match_key(GOOD_KEY, [GOOD_KEY]) is True

    def test_any_member_of_the_list_matches(self):
        assert match_key(OTHER_KEY, [GOOD_KEY, OTHER_KEY]) is True

    def test_non_member_rejected(self):
        assert match_key("nope", [GOOD_KEY, OTHER_KEY]) is False

    def test_empty_accept_list_rejects(self):
        assert match_key(GOOD_KEY, []) is False

    def test_non_ascii_does_not_raise(self):
        # `hmac.compare_digest` raises TypeError on non-ASCII `str`. A key with a
        # stray non-ASCII character must fail to match, not take down every
        # request with a 500.
        assert match_key("金鑰", [GOOD_KEY]) is False
        assert match_key(GOOD_KEY, ["金鑰"]) is False
        assert match_key("金鑰", ["金鑰"]) is True

    def test_prefix_is_not_a_match(self):
        assert match_key(GOOD_KEY[:-1], [GOOD_KEY]) is False


class TestFingerprint:
    def test_is_short_hex_and_stable(self):
        fp = fingerprint_rejected_key(GOOD_KEY)
        assert len(fp) == 12
        assert all(c in "0123456789abcdef" for c in fp)
        assert fp == fingerprint_rejected_key(GOOD_KEY)

    def test_differs_per_value(self):
        assert fingerprint_rejected_key(GOOD_KEY) != fingerprint_rejected_key(OTHER_KEY)

    def test_is_not_the_value(self):
        assert GOOD_KEY not in fingerprint_rejected_key(GOOD_KEY)


# ============================================================
# Observe mode — the shipped default
# ============================================================


class TestObserveMode:
    def test_unkeyed_request_passes_through(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={})
        assert res.status_code == 200

    def test_wrong_key_passes_through(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: "wrong"})
        assert res.status_code == 200

    def test_no_keys_configured_passes_through(self):
        assert client().post("/calculate", json={}).status_code == 200

    def test_counts_absent_and_invalid_separately(self, monkeypatch):
        # A wrong key means a drifted service or an attacker probing; a missing
        # key means a caller nobody keyed. Collapsing them loses that.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter()
        c = client(counter)
        c.post("/calculate", json={})
        c.post("/calculate", json={}, headers={ENGINE_KEY_HEADER: "wrong"})
        c.post("/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY})
        payload = counter.drain()
        assert payload["totals"] == {
            OUTCOME_ABSENT: 1,
            OUTCOME_INVALID: 1,
            OUTCOME_KEYED: 1,
        }

    def test_unconfigured_is_its_own_outcome(self):
        counter = RejectionCounter()
        client(counter).post("/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY})
        assert counter.drain()["totals"] == {OUTCOME_UNCONFIGURED: 1}

    def test_counts_per_path_and_caller(self, monkeypatch):
        # B3-b's gate is "every endpoint saw >=1 KEYED request". A global total
        # cannot distinguish "that path is keyed" from "that path never ran",
        # and /calculate alone is hit from three different NestJS call sites.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter()
        c = client(counter)
        c.post(
            "/calculate",
            json={},
            headers={ENGINE_KEY_HEADER: GOOD_KEY, CALLER_HEADER: "bazi.reading"},
        )
        c.post(
            "/calculate",
            json={},
            headers={ENGINE_KEY_HEADER: GOOD_KEY, CALLER_HEADER: "zwds.calculate"},
        )
        keyed = counter.drain()["by_path"][OUTCOME_KEYED]
        assert keyed == {"/calculate<-bazi.reading": 1, "/calculate<-zwds.calculate": 1}

    def test_missing_caller_header_is_labelled_unknown(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter()
        client(counter).post("/calculate", json={})
        assert "/calculate<-unknown" in counter.drain()["by_path"][OUTCOME_ABSENT]


# ============================================================
# Enforce mode — B3-b, the flag flip
# ============================================================


class TestEnforceMode:
    @pytest.fixture(autouse=True)
    def enforcing(self, monkeypatch):
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")

    def test_correct_key_passes(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY})
        assert res.status_code == 200

    def test_absent_key_rejected(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        assert client().post("/calculate", json={}).status_code == 401

    def test_wrong_key_rejected(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: OTHER_KEY})
        assert res.status_code == 401

    def test_rotation_second_key_accepted(self, monkeypatch):
        # add-new -> redeploy engine -> switch caller -> remove-old, with no
        # window in which one of the two is refused.
        monkeypatch.setenv("ENGINE_KEYS", f"{GOOD_KEY},{OTHER_KEY}")
        for key in (GOOD_KEY, OTHER_KEY):
            res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: key})
            assert res.status_code == 200

    def test_no_keys_configured_fails_closed(self):
        # The deployment mistake must be loud. "No keys set" refusing everyone is
        # recoverable in one env-var edit; admitting everyone is the hole this
        # row exists to close, silently.
        assert client().post("/calculate", json={}).status_code == 401
        res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY})
        assert res.status_code == 401

    def test_rejection_body_names_no_secret(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={}, headers={ENGINE_KEY_HEADER: OTHER_KEY})
        assert GOOD_KEY not in res.text and OTHER_KEY not in res.text

    def test_request_id_echoed_on_rejection(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        res = client().post("/calculate", json={}, headers={"x-request-id": "req-42"})
        assert res.status_code == 401
        assert res.headers.get("x-request-id") == "req-42"


# ============================================================
# The observe path must never change a response
# ============================================================


class _BrokenCounter(RejectionCounter):
    def record(self, *args, **kwargs):  # noqa: D102
        raise RuntimeError("counter exploded")


class TestBookkeepingCannotBreakRequests:
    def test_observe_mode_serves_normally_when_counter_raises(self, monkeypatch, caplog):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        with caplog.at_level(logging.ERROR, logger="bazi_engine.auth"):
            res = client(_BrokenCounter()).post(
                "/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY}
            )
        assert res.status_code == 200
        assert "bookkeeping failed" in caplog.text

    def test_enforce_mode_fails_closed_when_counter_raises(self, monkeypatch):
        # Symmetry would be wrong here. If we cannot establish the outcome we
        # cannot establish that the caller was keyed, so the safe direction is
        # refuse — even though the same fault is a pass-through in observe mode.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        res = client(_BrokenCounter()).post(
            "/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY}
        )
        assert res.status_code == 401


# ============================================================
# Hostile input into the log line
# ============================================================


class TestLogSafety:
    def test_caller_header_cannot_inject_a_log_record(self, monkeypatch, caplog):
        # The caller label is attacker-controllable and lands in a log line, so
        # the property under test is that a newline cannot FORGE A SECOND
        # RECORD. (The literal text "ENGINE-AUTH-ROLLUP" surviving inside a JSON
        # string value is harmless — it is the line break that would let a
        # scanner write a fake all-clear into Railway's log.)
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter(interval_seconds=0)
        forged = 'evil\nENGINE-AUTH-ROLLUP {"totals": {"absent": 0}}'
        with caplog.at_level(logging.INFO, logger="bazi_engine.auth"):
            client(counter).post("/calculate", json={}, headers={CALLER_HEADER: forged})
            flush_counter(counter)
        emitted = [r for r in caplog.records if "ENGINE-AUTH-ROLLUP" in r.getMessage()]
        assert len(emitted) == 1
        message = emitted[0].getMessage()
        assert "\n" not in message and "\r" not in message
        # The real window is reported, not the forged one.
        payload = json.loads(message.split("ENGINE-AUTH-ROLLUP ", 1)[1])
        assert payload["totals"] == {OUTCOME_ABSENT: 1}

    def test_caller_header_is_truncated(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter()
        client(counter).post("/calculate", json={}, headers={CALLER_HEADER: "a" * 500})
        label = next(iter(counter.drain()["by_path"][OUTCOME_ABSENT]))
        assert len(label.split("<-")[1]) <= 48

    def test_distinct_paths_are_capped(self):
        counter = RejectionCounter()
        for i in range(80):
            counter.record(OUTCOME_ABSENT, f"/scan-{i}", "unknown")
        labels = counter.drain()["by_path"][OUTCOME_ABSENT]
        assert "<other><-unknown" in labels
        assert len(labels) <= 51

    def test_rejected_fingerprints_are_capped(self):
        counter = RejectionCounter()
        for i in range(50):
            counter.record(OUTCOME_INVALID, "/calculate", "unknown", f"fp{i:04d}")
        assert len(counter.drain()["rejected_key_fingerprints"]) <= 10

    def test_emitted_line_never_contains_the_key(self, monkeypatch, caplog):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter(interval_seconds=0)
        with caplog.at_level(logging.INFO, logger="bazi_engine.auth"):
            client(counter).post(
                "/calculate", json={}, headers={ENGINE_KEY_HEADER: OTHER_KEY}
            )
            flush_counter(counter)
        assert "ENGINE-AUTH-ROLLUP" in caplog.text
        assert OTHER_KEY not in caplog.text
        assert GOOD_KEY not in caplog.text
        assert fingerprint_rejected_key(OTHER_KEY) in caplog.text

    def test_unkeyed_window_logs_at_warning(self, monkeypatch, caplog):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter(interval_seconds=0)
        with caplog.at_level(logging.INFO, logger="bazi_engine.auth"):
            client(counter).post("/calculate", json={})
            flush_counter(counter)
        assert any(r.levelno == logging.WARNING for r in caplog.records)

    def test_all_keyed_window_logs_at_info(self, monkeypatch, caplog):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        counter = RejectionCounter(interval_seconds=0)
        with caplog.at_level(logging.INFO, logger="bazi_engine.auth"):
            client(counter).post(
                "/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY}
            )
            flush_counter(counter)
        assert caplog.records
        assert all(r.levelno == logging.INFO for r in caplog.records)


# ============================================================
# Rollup mechanics
# ============================================================


class TestRollup:
    def test_drain_on_empty_returns_none(self):
        assert RejectionCounter().drain() is None

    def test_drain_resets_the_window(self):
        counter = RejectionCounter()
        counter.record(OUTCOME_ABSENT, "/calculate", "unknown")
        assert counter.drain()["totals"] == {OUTCOME_ABSENT: 1}
        assert counter.drain() is None

    def test_not_due_before_the_interval(self):
        counter = RejectionCounter(interval_seconds=3600)
        counter.record(OUTCOME_ABSENT, "/calculate", "unknown")
        assert counter.due() is False

    def test_due_once_the_interval_elapses(self):
        counter = RejectionCounter(interval_seconds=0)
        counter.record(OUTCOME_ABSENT, "/calculate", "unknown")
        assert counter.due() is True

    def test_empty_counter_is_never_due(self):
        assert RejectionCounter(interval_seconds=0).due() is False

    def test_rollup_reports_the_active_mode(self, monkeypatch):
        counter = RejectionCounter()
        counter.record(OUTCOME_ABSENT, "/calculate", "unknown")
        assert counter.drain()["mode"] == "observe"
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        counter.record(OUTCOME_ABSENT, "/calculate", "unknown")
        assert counter.drain()["mode"] == "enforce"

    def test_flush_on_empty_emits_nothing(self, caplog):
        with caplog.at_level(logging.INFO, logger="bazi_engine.auth"):
            flush_counter(RejectionCounter())
        assert "ENGINE-AUTH-ROLLUP" not in caplog.text

    def test_flush_survives_a_broken_counter(self, caplog):
        class Exploding(RejectionCounter):
            def drain(self, now=None):
                raise RuntimeError("boom")

        with caplog.at_level(logging.ERROR, logger="bazi_engine.auth"):
            flush_counter(Exploding())  # must not raise on shutdown
        assert "final flush failed" in caplog.text


# ============================================================
# Wiring — against the REAL engine app
# ============================================================


class TestEngineWiring:
    def test_health_is_exempt_in_observe_mode(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        from app.main import app as engine_app

        assert TestClient(engine_app).get("/health").status_code == 200

    def test_health_is_exempt_in_enforce_mode(self, monkeypatch):
        # If a Railway healthcheck path is ever configured, this is what stops
        # the enforce flip from failing every deploy.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        from app.main import app as engine_app

        assert TestClient(engine_app).get("/health").status_code == 200

    def test_health_is_not_counted(self, monkeypatch):
        # A continuously-probed /health would keep the counter permanently
        # non-zero and B3-b's gate could never pass.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        from app import main as engine_main

        engine_main._engine_auth_counter.drain()
        TestClient(engine_main.app).get("/health")
        assert engine_main._engine_auth_counter.drain() is None

    def test_real_endpoint_is_rejected_when_enforcing(self, monkeypatch):
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        from app.main import app as engine_app

        assert TestClient(engine_app).post("/calculate", json={}).status_code == 401

    def test_real_endpoint_reaches_validation_when_keyed(self, monkeypatch):
        # 422 rather than 401: the request got past auth and into FastAPI's
        # own validation, which is what "passes through" means here.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        from app.main import app as engine_app

        res = TestClient(engine_app).post(
            "/calculate", json={}, headers={ENGINE_KEY_HEADER: GOOD_KEY}
        )
        assert res.status_code == 422

    def test_cors_preflight_is_answered_before_auth(self, monkeypatch):
        # Proves the middleware ORDER. If auth were the outer layer this would
        # be a 401, and every browser preflight would also land in the counter.
        monkeypatch.setenv("ENGINE_KEYS", GOOD_KEY)
        monkeypatch.setenv("ENGINE_REQUIRE_KEY", "1")
        from app.main import app as engine_app

        res = TestClient(engine_app).options(
            "/calculate",
            headers={
                "Origin": "http://localhost:4000",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert res.status_code == 200

    def test_docs_are_served_outside_production(self):
        from app.main import app as engine_app

        c = TestClient(engine_app)
        assert c.get("/docs").status_code == 200
        assert c.get("/openapi.json").status_code == 200

    def test_docs_are_off_in_production(self, monkeypatch):
        # The docs decision is made at import time, so this reloads the module
        # with the prod marker set rather than pretending a runtime flag exists.
        monkeypatch.setenv("ENGINE_ENV", "production")
        from app import main as engine_main

        reloaded = importlib.reload(engine_main)
        try:
            assert reloaded.app.docs_url is None
            assert reloaded.app.redoc_url is None
            assert reloaded.app.openapi_url is None
            c = TestClient(reloaded.app)
            assert c.get("/docs").status_code == 404
            assert c.get("/openapi.json").status_code == 404
        finally:
            monkeypatch.delenv("ENGINE_ENV", raising=False)
            importlib.reload(engine_main)


class TestLoggingSetup:
    def test_configure_is_idempotent(self):
        engine_auth.configure_auth_logging()
        engine_auth.configure_auth_logging()
        assert len(engine_auth.logger.handlers) == 1

    def test_configure_does_not_switch_on_logging_globally(self):
        # The whole reason this is not `logging.basicConfig(level=INFO)`: that
        # would switch on INFO for every library in the process, httpx included,
        # and httpx logs full request URLs.
        root = logging.getLogger()
        before_level, before_handlers = root.level, list(root.handlers)
        engine_auth.configure_auth_logging()
        assert root.level == before_level
        assert list(root.handlers) == before_handlers
        assert engine_auth.logger.level == logging.INFO

    def test_records_remain_visible_to_root_handlers(self):
        # `propagate` must stay True. With it False these records never reach a
        # root handler — which is how pytest's caplog works, so every assertion
        # that "the key is never logged" would pass by capturing nothing.
        engine_auth.configure_auth_logging()
        assert engine_auth.logger.propagate is True
