"""TCVGH Agent Platform: Platform API + Agent Runtime (FastAPI on Cloud Run)."""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .auth import User, current_user
from .config import settings
from .engine import llm
from .permissions import RESOURCES
from .routers import (
    tts,
    agents,
    audit,
    calendar,
    chat,
    connectors,
    db_connectors,
    gateway_catalog,
    feedback,
    features,
    gateway_connectors,
    groups,
    knowledge,
    model_registry,
    monitoring,
    my_connectors,
    oauth_proxy,
    originals,
    permissions,
    projects,
    roles,
    routing,
    runs,
    schedules,
    sessions,
    shares,
    step_runs,
    skills,
    spaces,
    users,
)

app = FastAPI(title="TCVGH Agent Platform API", version="0.2.0")

# In production the frontend is served by Firebase Hosting with /api/* rewritten to this
# service (same origin), so CORS only matters for `npm run dev`.
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])

app.include_router(agents.router)
app.include_router(runs.router)
app.include_router(knowledge.router)
app.include_router(audit.router)
app.include_router(connectors.router)
app.include_router(db_connectors.router)
app.include_router(tts.router)
app.include_router(monitoring.router)
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(groups.directory_router)
app.include_router(skills.router)
app.include_router(schedules.router)
app.include_router(spaces.router)
app.include_router(roles.router)
app.include_router(permissions.router)
app.include_router(routing.router)
app.include_router(features.router)
app.include_router(model_registry.router)
app.include_router(projects.router)
app.include_router(sessions.router)
app.include_router(shares.router)
app.include_router(step_runs.router)
app.include_router(chat.router)
app.include_router(feedback.router)
app.include_router(originals.router)
app.include_router(calendar.router)
app.include_router(my_connectors.router)
app.include_router(gateway_catalog.router)
app.include_router(gateway_connectors.router)
app.include_router(oauth_proxy.router)


@app.get("/api/health")
def health():
    # Note: Cloud Run's frontend answers /healthz itself (404), so health lives under /api.
    s = settings()
    return {"ok": True, "project": s.google_cloud_project, "region": s.region, "deid": "always", "dlp_inspect_template": s.dlp_inspect_template,
            "rag_enabled": s.rag_enabled, "rag_location": s.rag_location}


@app.get("/api/models")
def model_groups(user: User = Depends(current_user)):
    """Selectable model groups with their live LiteLLM members and fallback chain (Studio labels)."""
    return {"groups": llm.routing_table(), "models": llm.model_catalog()}


def _granted_permissions(user: User) -> list[str]:
    """Distinct permission ids from the user's own roles and from the roles of every group the user belongs to,
    in the order of app/permissions.py. A missing role or group document contributes nothing."""
    role_ids = set(user.roles)
    for gid in user.groups:
        snap = db.client().collection("groups").document(gid).get()
        role_ids.update(r for r in (snap.to_dict() or {}).get("role_ids") or [] if isinstance(r, str))
    granted: set[str] = set()
    for rid in role_ids:
        snap = db.client().collection("roles").document(rid).get()
        granted.update(p for p in (snap.to_dict() or {}).get("permissions") or [] if isinstance(p, str))
    return [rid for rid, _name, _desc in RESOURCES if rid in granted]


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    """Profile for the frontend. `roles` are the assigned role ids; `permissions` the resource ids granted by them.
    Display/UI only: the backend guards (require_admin, require_builder) still decide access."""
    return {"uid": user.uid, "email": user.email, "name": user.name, "role": user.role, "department": user.department,
            "roles": list(user.roles), "groups": list(user.groups), "permissions": _granted_permissions(user)}
