"""TCVGH Agent Platform: Platform API + Agent Runtime (FastAPI on Cloud Run)."""
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import User, current_user
from .config import settings
from .engine import llm
from .routers import (
    agents,
    audit,
    calendar,
    chat,
    connectors,
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
    projects,
    roles,
    routing,
    runs,
    schedules,
    sessions,
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
app.include_router(monitoring.router)
app.include_router(users.router)
app.include_router(groups.router)
app.include_router(groups.directory_router)
app.include_router(skills.router)
app.include_router(schedules.router)
app.include_router(spaces.router)
app.include_router(roles.router)
app.include_router(routing.router)
app.include_router(features.router)
app.include_router(model_registry.router)
app.include_router(projects.router)
app.include_router(sessions.router)
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


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"uid": user.uid, "email": user.email, "name": user.name, "role": user.role, "department": user.department}
