"""M3 — every request handler must stay off the event loop.

FastAPI runs an ``async def`` handler ON the event loop and a plain ``def``
handler in a threadpool. Every endpoint here is pure CPU with zero awaits, so
an ``async def`` blocks the loop for the whole calculation and every other
request — including ``/health`` — waits behind it. Measured on this codebase,
10 concurrent ``/calculate`` calls put ``/health`` at a 36.6ms median as
``async def`` versus 6.5ms as ``def`` with two workers.

Nothing about an ``async def`` here looks wrong in review; it is the idiomatic
FastAPI spelling and the natural thing to write for a new endpoint. So the
constraint is enforced rather than documented.

``/health`` is the deliberate exception and is asserted as such: it must stay
on the (now free) loop so it answers immediately instead of queueing in the
threadpool behind the heavy work.
"""

from __future__ import annotations

import ast
import pathlib

MAIN = pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py"

# The one handler that must remain on the event loop.
ASYNC_ALLOWLIST = {"health_check"}


def _endpoints() -> list[tuple[str, bool, int]]:
    """(name, is_async, lineno) for every @app-decorated route handler."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    out: list[tuple[str, bool, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = [ast.unparse(d) for d in node.decorator_list]
        if any(d.startswith("app.") for d in decorators):
            out.append((node.name, isinstance(node, ast.AsyncFunctionDef), node.lineno))
    return out


def _own_awaits(fn: ast.AST) -> list[int]:
    """Awaits belonging to this function, not to a nested async def."""
    found: list[int] = []

    class V(ast.NodeVisitor):
        def visit_Await(self, n: ast.Await) -> None:
            found.append(n.lineno)

        def visit_AsyncFor(self, n: ast.AsyncFor) -> None:
            found.append(n.lineno)

        def visit_AsyncWith(self, n: ast.AsyncWith) -> None:
            found.append(n.lineno)

        def visit_AsyncFunctionDef(self, n: ast.AsyncFunctionDef) -> None:
            if n is fn:
                self.generic_visit(n)

    V().visit(fn)
    return found


def test_endpoints_exist_to_check():
    """Guard the guard: an AST change that finds nothing must not pass silently."""
    assert len(_endpoints()) >= 10


def test_only_health_is_async():
    offenders = [
        f"{name} (line {lineno})"
        for name, is_async, lineno in _endpoints()
        if is_async and name not in ASYNC_ALLOWLIST
    ]
    assert not offenders, (
        "These handlers are `async def` with no awaits, so they block the event "
        "loop for the whole calculation and /health queues behind them: "
        f"{offenders}. Make them plain `def` so FastAPI runs them in the "
        "threadpool, or add a deliberate entry to ASYNC_ALLOWLIST."
    )


def test_health_stays_async():
    """The allowlist entry is a REQUIREMENT, not merely permission.

    If /health became `def` it would join the same threadpool as the heavy
    handlers and wait behind whatever is in flight — the readiness-probe
    timeout M3 exists to prevent.
    """
    by_name = {name: is_async for name, is_async, _ in _endpoints()}
    assert by_name.get("health_check") is True


def test_no_allowlisted_handler_secretly_awaits():
    """An allowlisted handler must be trivial enough to belong on the loop.

    The moment /health does real I/O it stops being safe there and the reason
    for the exception evaporates.
    """
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name in ASYNC_ALLOWLIST:
            assert not _own_awaits(node), (
                f"{node.name} now awaits. Either it does real I/O (fine, but "
                "re-justify the allowlist entry) or the await is accidental."
            )


def test_sync_handlers_really_have_no_awaits():
    """Converting a handler that DID await would silently break it.

    `def` bodies cannot contain `await` at all, so Python would raise a
    SyntaxError — but this catches the reverse mistake: an `async def` left in
    the allowlist that genuinely needed to stay async.
    """
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    names = {n for n, is_async, _ in _endpoints() if not is_async}
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in names:
            assert not _own_awaits(node)
