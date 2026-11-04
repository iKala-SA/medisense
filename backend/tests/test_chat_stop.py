"""停止 (ChatGPT-style stop): a stopped turn keeps the answer streamed so far and stays in the conversation."""
from app.engine import agent as agent_runtime
from app.routers import runs
from app.schemas import AgentIn, StepTrace

from .conftest import BUILDER


def stopping_run(partial, steps=()):
    def run_agent(*a, emit=None, **k):
        raise runs.RunStopped(partial, list(steps))
    return run_agent


def test_a_stopped_turn_saves_the_partial_answer(fs, monkeypatch, audit_log):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    step = StepTrace(node_id="t1", type="knowledge", summary="檢索院內文件")
    monkeypatch.setattr(agent_runtime, "run_agent", stopping_run("高血壓的第一線用藥有", [step]))
    r = runs.execute_run(AgentIn(name="Medisense"), [], "general-chat", BUILDER, "高血壓用藥？", "s1", emit=lambda e: None)
    assert r.reply == "高血壓的第一線用藥有" and r.session_id == "s1" and [t.summary for t in r.trace] == ["檢索院內文件"]
    sess = fs.collection("sessions").document("s1").get().to_dict()
    assert [m["role"] for m in sess["messages"]] == ["user", "assistant"]
    assert sess["messages"][1]["content"] == "高血壓的第一線用藥有" and sess["messages"][1]["meta"]["stopped"] is True
    assert sess["pending"] is None
    assert [a for a in audit_log() if a["action"] == "agent.run"][-1]["stopped"] is True


def test_a_turn_stopped_before_any_text_is_marked(fs, monkeypatch):
    monkeypatch.setattr("app.engine.deid.deidentify", lambda t: t)
    monkeypatch.setattr(agent_runtime, "run_agent", stopping_run("  "))
    r = runs.execute_run(AgentIn(name="Medisense"), [], "general-chat", BUILDER, "hi", "s2", emit=lambda e: None)
    assert r.reply == runs.STOPPED_EMPTY == fs.collection("sessions").document("s2").get().to_dict()["messages"][1]["content"]


def test_stop_is_not_swallowed_by_ordinary_error_handling():
    try:
        try:
            raise runs.RunStopped("x")
        except Exception:  # noqa: BLE001 - what model fallback / tool wrappers do
            raise AssertionError("caught as an ordinary error")
    except runs.RunStopped as e:
        assert e.partial == "x"
