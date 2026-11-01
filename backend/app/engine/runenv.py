"""Which environment a run belongs to: "production" (a published agent: chat, schedules) or "sandbox" (a draft being tested).

Set once at the top of a run (a ContextVar, so it follows the request thread) and read by the places that must behave differently:
write actions are only simulated in the sandbox, and usage / audit / sessions are tagged so the sandbox is counted separately.
This is the logical sandbox inside the platform; a Google Agent Runtime / Agent Engine sandbox is a later step."""
from contextlib import contextmanager
from contextvars import ContextVar

PRODUCTION, SANDBOX = "production", "sandbox"
_env: ContextVar[str] = ContextVar("run_env", default=PRODUCTION)


def get() -> str:
    return _env.get()


def is_sandbox() -> bool:
    return _env.get() == SANDBOX


def of(use_published: bool) -> str:
    """A run on the published snapshot is production; a run on the draft is the sandbox."""
    return PRODUCTION if use_published else SANDBOX


@contextmanager
def use(env: str):
    token = _env.set(env)
    try:
        yield
    finally:
        _env.reset(token)
