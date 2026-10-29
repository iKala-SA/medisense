"""Agent CRUD + publish.

Visibility (decided 2026-10-24): publish == hospital-wide. Everyone signed in sees every published
agent in the Hub and may run its published version; only the owner (or an admin) edits or deletes.
Drafts are private to their owner.

Publish review (decided 2026-10-26): builders request, an admin approves. The request freezes the
draft as versions/{n+1}; approving makes exactly that snapshot live. `review` is separate from
`status`, so v1 stays live while v2 waits. Admins publish their own (or any) agent directly.
Taking an agent down needs no review.
"""
from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from .. import db, sharing
from ..auth import User, current_user, require_admin, require_builder
from ..engine import steps as step_engine
from ..engine.flow import validate_flow
from ..schemas import AgentActivity, AgentDraftIn, AgentIn, AgentOut, Flow, HubStats, ReviewDecision, SandboxActivity, Share, StepsIn

router = APIRouter(prefix="/api/agents", tags=["agents"])
ACTIVITY_CAP = 50000  # agent.run audit rows read for today's sandbox activity


def _doc_to_out(doc) -> AgentOut:
    d = doc.to_dict() or {}
    return AgentOut(id=doc.id, **d)


def can_edit(data: dict, user: User) -> bool:
    """Owner (while still a builder) or any admin. A demoted owner keeps the agent but only runs its published version."""
    if user.role == "admin" or (data.get("owner_uid") == user.uid and user.role == "builder"):
        return True
    # Shared with edit rights (agent.share): only people who may build at all can edit.
    return user.role == "builder" and sharing.can_edit(user, data)


def load_editable(agent_id: str, user: User):
    snap = db.client().collection("agents").document(agent_id).get()
    if not snap.exists:
        raise HTTPException(404, "agent not found")
    if not can_edit(snap.to_dict() or {}, user):
        raise HTTPException(403, "not your agent")
    return snap


def load_visible(agent_id: str, user: User):
    snap = db.client().collection("agents").document(agent_id).get()
    if not snap.exists:
        raise HTTPException(404, "agent not found")
    data = snap.to_dict() or {}
    if not can_edit(data, user) and data.get("status") != "published" and not sharing.can_view(user, data):
        raise HTTPException(403, "agent is not published")
    return snap


@router.get("", response_model=list[AgentOut])
def list_agents(user: User = Depends(current_user)):
    """Own agents (any status) + everyone's published agents, newest first."""
    col = db.client().collection("agents")
    seen: dict[str, AgentOut] = {}
    mine = col.where(filter=firestore.FieldFilter("owner_uid", "==", user.uid))
    for d in mine.order_by("updated_at", direction=firestore.Query.DESCENDING).stream():
        seen[d.id] = _doc_to_out(d)
    published = col.where(filter=firestore.FieldFilter("status", "==", "published"))
    for d in published.order_by("updated_at", direction=firestore.Query.DESCENDING).stream():
        seen.setdefault(d.id, _doc_to_out(d))
    for d_id, d in sharing.visible_docs("agents", user, admin_all=False).items():  # shared with me (drafts too)
        if d_id not in seen:
            seen[d_id] = _doc_to_out(d)
    return sorted(seen.values(), key=lambda a: str(a.updated_at or ""), reverse=True)


@router.get("/stats", response_model=HubStats)
def hub_stats(user: User = Depends(current_user)):
    c = db.client()
    agents = c.collection("agents")
    mine = list(agents.where(filter=firestore.FieldFilter("owner_uid", "==", user.uid)).stream())
    published = list(agents.where(filter=firestore.FieldFilter("status", "==", "published")).stream())
    start = db.now().replace(hour=0, minute=0, second=0, microsecond=0)
    runs_today = sum(1 for _ in c.collection("audit")
                     .where(filter=firestore.FieldFilter("action", "==", "agent.run"))
                     .where(filter=firestore.FieldFilter("at", ">=", start)).stream())
    knowledge = len({k for d in mine for k in (d.to_dict() or {}).get("knowledge_doc_ids") or []})
    return HubStats(
        my_agents=len(mine),
        my_published=sum(1 for d in mine if (d.to_dict() or {}).get("status") == "published"),
        hospital_published=len(published),
        runs_today=runs_today,
        knowledge_files=knowledge,
    )


@router.get("/activity", response_model=SandboxActivity)
def sandbox_activity(user: User = Depends(require_builder)):
    """Today's runs per agent (audit `agent.run` rows) + the review queue size for the sandbox page."""
    c = db.client()
    start = db.now().replace(hour=0, minute=0, second=0, microsecond=0)
    runs = (c.collection("audit").where(filter=firestore.FieldFilter("action", "==", "agent.run"))
            .where(filter=firestore.FieldFilter("at", ">=", start)).limit(ACTIVITY_CAP))
    acc: dict[str, list[int]] = {}
    total = ms = 0
    for d in runs.stream():
        r = d.to_dict() or {}
        a = acc.setdefault(r.get("agent_id", ""), [0, 0])
        a[0] += 1
        a[1] += int(r.get("latency_ms") or 0)
        total += 1
        ms += int(r.get("latency_ms") or 0)
    pending = c.collection("agents").where(filter=firestore.FieldFilter("review.state", "==", "pending"))
    if user.role != "admin":
        pending = pending.where(filter=firestore.FieldFilter("owner_uid", "==", user.uid))
    return SandboxActivity(
        runs_today=total, avg_latency_ms=ms // total if total else 0,
        pending_reviews=sum(1 for _ in pending.stream()),
        by_agent={k: AgentActivity(runs=n, avg_latency_ms=t // n) for k, (n, t) in acc.items() if k},
        capped=total >= ACTIVITY_CAP,
    )


@router.get("/reviews", response_model=list[AgentOut])
def review_queue(user: User = Depends(require_admin)):
    """Agents waiting for publish approval, oldest request first."""
    q = db.client().collection("agents").where(filter=firestore.FieldFilter("review.state", "==", "pending"))
    rows = [_doc_to_out(d) for d in q.stream()]
    return sorted(rows, key=lambda a: str(a.review.requested_at if a.review else ""))


@router.post("", response_model=AgentOut, status_code=201)
def create_agent(body: AgentIn, user: User = Depends(require_builder)):
    ref = db.client().collection("agents").document()
    data = {**body.model_dump(), **sharing.share_fields(sharing.validate_share(body.share)), "owner_uid": user.uid,
            "owner_email": user.email, "status": "draft", "version": 0, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "agent.create", user.email, agent_id=ref.id, name=body.name)
    return AgentOut(id=ref.id, **data)


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, user: User = Depends(current_user)):
    return _doc_to_out(load_visible(agent_id, user))


@router.post("/draft")
def draft_agent(body: AgentDraftIn, user: User = Depends(require_builder)):
    """Build / edit an agent by conversation. Nothing is saved: the client shows the draft and saves it when the user says so."""
    from ..engine import agent_builder, connectors as conn_engine
    from .spaces import _viewable

    c = db.client()
    rows = []
    for d in c.collection("connectors").stream():
        x = d.to_dict() or {}
        acts = conn_engine.TYPES.get(x.get("type", ""), {}).get("actions")
        if isinstance(acts, list) and x.get("enabled", True):
            rows.append({"id": d.id, "label": x.get("name") or x.get("type", ""), "actions": [{"id": a["id"], "label": a["label"]} for a in acts]})
    spaces = [{"id": d.id, "name": (d.to_dict() or {}).get("name", "")} for d in c.collection("spaces").stream() if _viewable(user, d.to_dict() or {})]
    try:
        out = agent_builder.draft(body.message, current=body.current, history=body.history, connector_rows=rows, space_rows=spaces, user_id=user.uid)
    except ValueError as exc:
        raise HTTPException(502, str(exc)) from exc
    db.audit(user.uid, "agent.draft", user.email, steps=len(out["agent"]["steps"]))
    return out


@router.post("/validate-steps")
def validate_step_list(body: StepsIn, user: User = Depends(require_builder)):
    return {"problems": step_engine.validate_steps(body.steps)}


@router.post("/validate")
def validate(flow: Flow, user: User = Depends(require_builder)):
    return {"problems": validate_flow(flow)}


@router.put("/{agent_id}", response_model=AgentOut)
def update_agent(agent_id: str, body: AgentIn, user: User = Depends(require_builder)):
    snap = load_editable(agent_id, user)
    # `share` only changes through PUT /{id}/share; skill_ids only when the client sent it (older clients omit it).
    optional = ("skill_ids", "icon", "opening_questions", "capabilities", "steps", "original_prompt")  # older clients omit these
    skip = {"share"} | {k for k in optional if k not in body.model_fields_set}
    data = {**body.model_dump(exclude=skip), "updated_at": db.now()}
    snap.reference.update(data)
    db.audit(user.uid, "agent.update", user.email, agent_id=agent_id)
    return _doc_to_out(snap.reference.get())


@router.put("/{agent_id}/share", response_model=AgentOut)
def share_agent(agent_id: str, body: Share, user: User = Depends(require_builder)):
    """Owner or admin sets who else can view / edit this agent. Publishing still makes it hospital-wide."""
    snap = db.client().collection("agents").document(agent_id).get()
    if not snap.exists:
        raise HTTPException(404, "agent not found")
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can change sharing")
    snap.reference.update({**sharing.share_fields(sharing.validate_share(body)), "updated_at": db.now()})
    db.audit(user.uid, "agent.share", user.email, agent_id=agent_id, access=body.access, role=body.role,
             members=len(body.members))
    return _doc_to_out(snap.reference.get())


def _check_flow(data: dict) -> None:
    problems = validate_flow(Flow.model_validate(data.get("flow") or {}))
    if problems:
        raise HTTPException(422, "; ".join(problems))
    from ..schemas import Step
    errs = [p["message"] for p in step_engine.validate_steps([Step.model_validate(x) for x in data.get("steps") or []]) if p["level"] == "error"]
    if errs:  # PRD §6.4: an agent with step errors cannot be published
        raise HTTPException(422, "Step 流程有錯誤：" + "；".join(errs))


def _go_live(ref, version: int, approver: User) -> None:
    """Make an existing snapshot the published version, recording who approved it."""
    at = db.now()
    ref.collection("versions").document(str(version)).set(
        {"published_at": at, "published_by": approver.uid, "approved_by_email": approver.email}, merge=True)
    ref.update({"status": "published", "version": version, "updated_at": at, "published_at": at,
                "approved_by_email": approver.email, "approved_at": at, "review": None})


@router.post("/{agent_id}/publish", response_model=AgentOut)
def publish_agent(agent_id: str, user: User = Depends(require_admin)):
    """Admin-only direct publish: snapshot the current draft and make it live (replaces any pending request)."""
    snap = load_editable(agent_id, user)
    data = snap.to_dict() or {}
    _check_flow(data)
    version = int(data.get("version", 0)) + 1
    snap.reference.collection("versions").document(str(version)).set(
        {**{k: v for k, v in data.items() if k != "review"}, "version": version})
    _go_live(snap.reference, version, user)
    db.audit(user.uid, "agent.publish", user.email, agent_id=agent_id, version=version)
    return _doc_to_out(snap.reference.get())


@router.post("/{agent_id}/publish-request", response_model=AgentOut)
def request_publish(agent_id: str, user: User = Depends(require_builder)):
    """Freeze the draft as the next version and queue it for admin review. Later draft edits are
    not part of the request; a rejected snapshot is overwritten by the next request."""
    snap = load_editable(agent_id, user)
    data = snap.to_dict() or {}
    if (data.get("review") or {}).get("state") == "pending":
        raise HTTPException(409, "a publish request is already pending")
    _check_flow(data)
    version = int(data.get("version", 0)) + 1
    at = db.now()
    snap.reference.collection("versions").document(str(version)).set(
        {**{k: v for k, v in data.items() if k != "review"}, "version": version, "requested_by": user.uid, "requested_at": at})
    snap.reference.update({"review": {"state": "pending", "version": version, "requested_by_email": user.email,
                                      "requested_at": at}, "updated_at": at})
    db.audit(user.uid, "agent.publish_request", user.email, agent_id=agent_id, version=version)
    return _doc_to_out(snap.reference.get())


@router.post("/{agent_id}/publish-request/withdraw", response_model=AgentOut)
def withdraw_publish(agent_id: str, user: User = Depends(require_builder)):
    snap = load_editable(agent_id, user)
    review = (snap.to_dict() or {}).get("review") or {}
    if review.get("state") != "pending":
        raise HTTPException(409, "no pending publish request")
    snap.reference.collection("versions").document(str(review["version"])).delete()
    snap.reference.update({"review": None, "updated_at": db.now()})
    db.audit(user.uid, "agent.publish_withdraw", user.email, agent_id=agent_id, version=review["version"])
    return _doc_to_out(snap.reference.get())


@router.post("/{agent_id}/review", response_model=AgentOut)
def review_publish(agent_id: str, body: ReviewDecision, user: User = Depends(require_admin)):
    """Admin approves (the frozen snapshot goes live) or rejects (reason required) a publish request."""
    snap = load_editable(agent_id, user)
    review = (snap.to_dict() or {}).get("review") or {}
    if review.get("state") != "pending":
        raise HTTPException(409, "no pending publish request")
    version = int(review["version"])
    if body.approve:
        _go_live(snap.reference, version, user)
        db.audit(user.uid, "agent.publish_approve", user.email, agent_id=agent_id, version=version)
    else:
        if not body.reason.strip():
            raise HTTPException(422, "a reason is required to reject")
        snap.reference.update({"review": {**review, "state": "rejected", "reason": body.reason.strip(),
                                          "decided_by_email": user.email, "decided_at": db.now()}})
        db.audit(user.uid, "agent.publish_reject", user.email, agent_id=agent_id, version=version, reason=body.reason.strip())
    return _doc_to_out(snap.reference.get())


@router.post("/{agent_id}/unpublish", response_model=AgentOut)
def unpublish_agent(agent_id: str, user: User = Depends(require_builder)):
    snap = load_editable(agent_id, user)
    snap.reference.update({"status": "draft", "updated_at": db.now()})
    db.audit(user.uid, "agent.unpublish", user.email, agent_id=agent_id)
    return _doc_to_out(snap.reference.get())


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str, user: User = Depends(require_builder)):
    snap = load_editable(agent_id, user)
    data = snap.to_dict() or {}
    # Library documents are shared and stay. Only agents not yet migrated still own a per-agent corpus.
    if data.get("rag_corpus"):
        from ..engine import rag

        rag.delete_corpus(data["rag_corpus"])
    for k in snap.reference.collection("knowledge").stream():
        k.reference.delete()
    snap.reference.delete()
    db.audit(user.uid, "agent.delete", user.email, agent_id=agent_id)
