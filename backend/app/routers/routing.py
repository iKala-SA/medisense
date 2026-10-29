"""Hospital-wide routing switches (config/routing), admin-only: 僅院內模型 and Model Armor (see engine/routing.py).
Model choice for "auto" is the gateway's smart-router, configured on the 模型 page."""
import json
import time

import openai
from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from .. import db
from ..auth import User, require_admin
from ..engine import llm
from ..engine import routing as eng
from ..schemas import RoutingConfigIn, RoutingConfigOut, RoutingTestIn, RoutingTestOut

router = APIRouter(prefix="/api/routing", tags=["routing"], dependencies=[Depends(require_admin)])
TEST_SYSTEM = "You are a hospital assistant. Answer briefly in the user's language."


def _ref():
    return db.client().collection("config").document("routing")


def _current() -> dict:
    snap = _ref().get()
    return {**eng.DEFAULT_CONFIG, **((snap.to_dict() if snap.exists else None) or {})}


@router.get("", response_model=RoutingConfigOut)
def get_routing():
    return RoutingConfigOut.model_validate(_current())


@router.put("", response_model=RoutingConfigOut)
def put_routing(body: RoutingConfigIn, user: User = Depends(require_admin)):
    snap = _ref().get()
    version = int(((snap.to_dict() if snap.exists else None) or {}).get("version", 0)) + 1
    # set() replaces the doc, which also drops the retired rule fields (rules, default_group, fallback_group).
    data = {**body.model_dump(), "version": version, "updated_by": user.email, "updated_at": db.now()}
    _ref().set(data)
    eng.reset_cache()
    db.audit(user.uid, "routing.update", user.email, version=version, sovereign_only=body.sovereign_only,
             model_armor=body.model_armor)
    return RoutingConfigOut.model_validate(data)


@router.post("/test", response_model=RoutingTestOut)
async def test_routing(body: RoutingTestIn, user: User = Depends(require_admin)):
    """One LIVE call through the gateway with the saved switches, as an "auto" agent would make it: Model Armor
    (when on) screens the prompt, then smart-router picks the model. A blocked prompt is a normal result here
    (blocked=true, status 400), not an error, so admins can try injection prompts."""
    eng.reset_cache()  # use the switches as saved right now, not this instance's 60 s cache
    res = eng.resolve_auto()
    armor = eng.model_armor()
    out = {"group": res.group, "reason": res.reason, "model_armor": armor}
    t0 = time.perf_counter()
    try:
        c = await run_in_threadpool(llm.complete, group=res.group, system=TEST_SYSTEM,
                                    messages=[{"role": "user", "content": body.text}],
                                    agent_id="routing-test", user_id=user.uid)
        result = RoutingTestOut(ok=True, status=200, model=c.model, text=c.text, ms=c.ms, **out)
    except openai.APIStatusError as e:
        msg = json.dumps(e.body, ensure_ascii=False, indent=2) if e.body else str(e)  # the gateway's error JSON
        result = RoutingTestOut(ok=False, status=e.status_code, blocked=e.status_code == 400 and "Model Armor" in msg,
                                error=msg[:2000], ms=int((time.perf_counter() - t0) * 1000), **out)
    except openai.APIError as e:  # connection / timeout: the gateway did not answer
        result = RoutingTestOut(ok=False, status=502, error=str(e)[:2000], ms=int((time.perf_counter() - t0) * 1000), **out)
    # The prompt itself is not audited: admins type injection attempts and possibly PHI here.
    db.audit(user.uid, "routing.test", user.email, group=res.group, model=result.model, status=result.status,
             blocked=result.blocked, model_armor=armor)
    return result
