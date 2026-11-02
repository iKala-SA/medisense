"""Database connectors (docs/DB-CONNECTORS-DESIGN.md): admin-only CRUD, plus what the signed-in user may use (/mine).

Passwords go to Secret Manager and never come back. Access follows the ordered group rules in engine/db_access.py."""
import logging
import socket

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..auth import User, current_user, require_admin, require_builder
from ..config import settings
from .. import sharing
from ..engine import db_access, db_login, db_sql, github_actions, toolbox_config
from ..engine import secrets as sm
from ..schemas import DbConnectorIn, DbConnectorOut

router = APIRouter(prefix="/api/db-connectors", tags=["db-connectors"])
log = logging.getLogger(__name__)
DONE = ("deployed", "failed")
START_TIMEOUT_S = 180  # a dispatch that never shows up as a run after this long is reported as failed


def _col():
    return db.client().collection("db_connectors")


def _load(cid: str):
    snap = _col().document(cid).get()
    if not snap.exists:
        raise HTTPException(404, "database connector not found")
    return snap


def _out(doc) -> DbConnectorOut:
    d = doc.to_dict() or {}
    srcs = [{"id": s["id"], "label": s["label"], "user": s["user"], "password_set": bool(s.get("password_secret"))} for s in d.get("sources") or []]
    return DbConnectorOut(id=doc.id, name=d.get("name", ""), kind=d["kind"], description=d.get("description", ""), connection=d.get("connection") or {},
                          sources=srcs, rules=d.get("rules") or [], queries=d.get("queries") or [], views=d.get("views") or [],
                          max_rows=d.get("max_rows", 100), status=d.get("status", "draft"), created_by=d.get("created_by", ""),
                          created_at=d.get("created_at"), updated_at=d.get("updated_at"))


def _check(body: DbConnectorIn) -> None:
    for g in {r.group_id for r in body.rules}:
        if not db.client().collection("groups").document(g).get().exists:
            raise HTTPException(422, f"group {g} not found")
    for q in body.queries:
        if (why := db_sql.check_query(q.statement, body.kind, len(q.parameters), [p.name for p in q.parameters])):
            raise HTTPException(422, f"查詢「{q.name}」：{why}")
    texts = [body.name, body.description, *body.connection.values(), *(s.label + s.user for s in body.sources),
             *(q.name + q.description + "".join(p.description for p in q.parameters) for q in body.queries),
             *(v.name + v.description for v in body.views)]
    if any("{{" in t or "${" in t for t in texts):  # these end up in tools.yaml, where {{ }} and ${ } are template / variable syntax
        raise HTTPException(422, "名稱、說明與連線欄位不可包含 {{ 或 ${")


def _store_passwords(cid: str, body: DbConnectorIn, old: dict | None) -> list[dict]:
    """sources as stored: password -> Secret Manager name. A source without a new password keeps its stored secret."""
    prev = {s["id"]: s for s in (old or {}).get("sources") or []}
    out = []
    for s in body.sources:
        secret = prev.get(s.id, {}).get("password_secret", "")
        if s.password:
            secret = sm.put(cid, f"src-{s.id}-password", s.password)
        if not secret:
            raise HTTPException(422, f"source '{s.label}' needs a password")
        out.append({"id": s.id, "label": s.label, "user": s.user, "password_secret": secret})
    for sid, s in prev.items():  # a source that was removed: its secret goes too
        if sid not in {x.id for x in body.sources} and s.get("password_secret"):
            sm.delete(s["password_secret"])
    return out


def _connectors() -> list[dict]:
    return [{**(d.to_dict() or {}), "id": d.id} for d in _col().stream()]


def _cfg(name: str):
    return db.client().collection("config").document(name)


def _render(user: User) -> dict:
    """Re-render tools.yaml into config/toolbox_render after a change; the version only moves when the content does."""
    cs = _connectors()
    yml, secrets = toolbox_config.render(cs), toolbox_config.required_secrets(cs)
    ref = _cfg("toolbox_render")
    prev = ref.get()
    old = (prev.to_dict() if prev.exists else None) or {}
    if old and old.get("yaml") == yml and old.get("secrets") == secrets:
        return old
    data = {"yaml": yml, "secrets": secrets, "version": int(old.get("version", 0)) + 1, "requested_by": user.email,
            "requested_at": db.now(), "problems": toolbox_config.problems(cs), "status": "rendered"}
    ref.set(data)
    return data


def _mark_applied(upto) -> None:
    """After a successful deploy: connectors last saved before the snapshot was taken are now live."""
    for d in _col().stream():
        c = d.to_dict() or {}
        if c.get("status") != "applied" and c.get("updated_at") and upto and c["updated_at"] <= upto:
            d.reference.update({"status": "applied"})


def _refresh(data: dict) -> dict:
    """Pull the GitHub run state into an unfinished config/toolbox_deploy record (best effort)."""
    if data.get("status") in DONE:
        return data
    try:
        run = github_actions.find_run(int(data.get("version", 0)), workflow=None, title=github_actions.toolbox_run_title(int(data.get("version", 0))))
    except (github_actions.NotConfigured, httpx.HTTPError) as e:
        log.warning("toolbox deploy status unavailable: %s", e)
        return data
    if not run:
        at = data.get("requested_at")
        if data.get("status") != "dispatched" or not at or (db.now() - at).total_seconds() < START_TIMEOUT_S:
            return data
        run = {"status": "completed", "conclusion": "not_started", "html_url": ""}
    status = ("deployed" if run["conclusion"] == "success" else "failed") if run["status"] == "completed" \
        else "deploying" if run["status"] == "in_progress" else "queued"
    patch = {"status": status, "run_url": run["html_url"] or ""}
    if patch != {k: data.get(k) for k in patch}:
        _cfg("toolbox_deploy").update(patch)
        if status == "deployed":
            _mark_applied(data.get("requested_at"))
    return {**data, **patch}


@router.get("/apply/state", dependencies=[Depends(require_admin)])
def apply_state():
    """The rendered tools.yaml (references secrets only, never values) and the last 套用 request with its run state."""
    r, d = _cfg("toolbox_render").get(), _cfg("toolbox_deploy").get()
    render = r.to_dict() if r.exists else None
    deploy = _refresh(d.to_dict() or {}) if d.exists else None
    pending = bool(render and render.get("yaml") and (not deploy or deploy.get("status") != "deployed" or deploy.get("version") != render.get("version")))
    return {"render": render, "deploy": deploy, "pending": pending}


@router.post("/apply")
def apply(user: User = Depends(require_admin)):
    """Snapshot the rendered tools.yaml and redeploy Toolbox through the GitHub Actions workflow (infra/13)."""
    data = _render(user)
    if (bad := toolbox_config.problems(_connectors())):
        raise HTTPException(409, "無法套用：" + "；".join(bad))
    if (bad := _login_problems(_connectors())):
        raise HTTPException(409, "無法套用，以下帳號登入失敗：" + "；".join(bad))
    deploy = _cfg("toolbox_deploy")
    cur = deploy.get()
    if cur.exists and _refresh(cur.to_dict() or {}).get("status") not in DONE:
        raise HTTPException(409, "已有一個套用正在進行")
    snap = {**data, "status": "dispatched", "run_url": "", "requested_by": user.email, "requested_at": db.now()}
    deploy.set(snap)
    try:
        github_actions.dispatch(data["version"], user.email, workflow=settings().toolbox_apply_workflow)
    except github_actions.NotConfigured as e:
        deploy.update({"status": "failed"})
        raise HTTPException(503, f"Toolbox 套用尚未設定：{e}") from e
    except httpx.HTTPError as e:
        deploy.update({"status": "failed"})
        raise HTTPException(502, f"無法啟動套用流程：{e}") from e
    db.audit(user.uid, "db_connector.apply", user.email, version=data["version"], connectors=len(_connectors()))
    return snap


@router.get("", response_model=list[DbConnectorOut], dependencies=[Depends(require_admin)])
def list_connectors():
    docs = sorted(_col().stream(), key=lambda d: str((d.to_dict() or {}).get("updated_at") or ""), reverse=True)
    return [_out(d) for d in docs]


@router.get("/catalog")
def catalog(user: User = Depends(require_builder)):
    """Names only, so an Agent builder can attach a database. What anyone may actually query is decided per user at run time."""
    return sorted(({"id": d.id, "name": (d.to_dict() or {}).get("name", ""), "kind": (d.to_dict() or {}).get("kind", "")} for d in _col().stream()),
                  key=lambda x: x["name"].lower())


@router.get("/mine")
def mine(user: User = Depends(current_user)):
    """The database connectors the caller can use and what each rule gives them (no SQL, no sensitive columns)."""
    groups = sharing.group_ids_of(user.email)
    out = []
    for d in _col().stream():
        c = d.to_dict() or {}
        g = db_access.grant(c, user.email, groups)
        if g:
            out.append({"id": d.id, "name": c.get("name", ""), "kind": c.get("kind", ""), "description": c.get("description", ""), **db_access.public_grant(g)})
    return sorted(out, key=lambda x: x["name"].lower())


@router.get("/{cid}", response_model=DbConnectorOut, dependencies=[Depends(require_admin)])
def get_connector(cid: str):
    return _out(_load(cid))


@router.post("", response_model=DbConnectorOut, status_code=201)
def create_connector(body: DbConnectorIn, user: User = Depends(require_admin)):
    _check(body)
    ref = _col().document()
    data = {**body.model_dump(exclude={"sources"}), "sources": _store_passwords(ref.id, body, None), "status": "draft",
            "created_by": user.email, "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    _render(user)
    db.audit(user.uid, "db_connector.create", user.email, connector_id=ref.id, name=body.name, kind=body.kind)
    return _out(ref.get())


@router.put("/{cid}", response_model=DbConnectorOut)
def update_connector(cid: str, body: DbConnectorIn, user: User = Depends(require_admin)):
    snap = _load(cid)
    old = snap.to_dict() or {}
    if body.kind != old.get("kind"):
        raise HTTPException(422, "the database kind cannot be changed")
    _check(body)
    snap.reference.update({**body.model_dump(exclude={"sources"}), "sources": _store_passwords(cid, body, old), "status": "draft", "updated_at": db.now()})
    _render(user)
    db.audit(user.uid, "db_connector.update", user.email, connector_id=cid, name=body.name,
             rules=len(body.rules), queries=len(body.queries), views=len(body.views))
    return _out(snap.reference.get())


@router.delete("/{cid}", status_code=204)
def delete_connector(cid: str, user: User = Depends(require_admin)):
    snap = _load(cid)
    d = snap.to_dict() or {}
    for s in d.get("sources") or []:
        if s.get("password_secret"):
            sm.delete(s["password_secret"])
    snap.reference.delete()
    _render(user)
    db.audit(user.uid, "db_connector.delete", user.email, connector_id=cid, name=d.get("name", ""))


@router.post("/{cid}/resolve")
def resolve(cid: str, body: dict, user: User = Depends(require_admin)):
    """Admin test tool: which rule would this e-mail hit, and what would it get?"""
    email = str(body.get("email", "")).strip().lower()
    if not email:
        raise HTTPException(422, "email is required")
    g = db_access.grant((_load(cid).to_dict() or {}), email)
    return {"email": email, "matched": g is not None, **(db_access.public_grant(g) if g else {})}


@router.post("/{cid}/check-sql")
def check_sql(cid: str, body: dict, user: User = Depends(require_admin)):
    """Admin test tool: would this SQL pass the guard for this e-mail's rule? (Nothing is executed.)"""
    email, sql = str(body.get("email", "")).strip().lower(), str(body.get("sql", ""))
    c = _load(cid).to_dict() or {}
    g = db_access.grant(c, email)
    if g is None:
        return {"ok": False, "reason": "此 email 沒有符合的規則：拒絕存取"}
    if not g["views"]:
        return {"ok": False, "reason": "這條規則沒有開放任何檢視表"}
    try:
        r = db_sql.guard_select(sql, c["kind"], g["views"], int(c.get("max_rows") or 100))
    except db_sql.SqlRejected as e:
        return {"ok": False, "reason": str(e)}
    return {"ok": True, **r}


@router.post("/test-connection", dependencies=[Depends(require_admin)])
def test_connection(body: dict):
    """驗證連線: with a user and password, a real login (postgres / mysql / mssql); without, a TCP reachability check.
    Cloud SQL and BigQuery cannot be tested from here and are verified at 套用."""
    kind, conn = str(body.get("kind", "")), body.get("connection") or {}
    host, port = str(conn.get("host", "")).strip(), str(conn.get("port", "")).strip()
    if not db_login.testable(kind) or not (host and port.isdigit() and 0 < int(port) < 65536):
        return {"ok": None, "message": "此類型無法在此預先驗證，將於套用到 Toolbox 時連線。"}
    if body.get("user") and body.get("password"):
        ok, msg = db_login.check(kind, {**conn, "host": host, "port": port}, str(body["user"]), str(body["password"]))
        return {"ok": ok, "message": msg}
    try:
        socket.create_connection((host, int(port)), timeout=5).close()
    except OSError as e:
        return {"ok": False, "message": f"無法連到 {host}:{port}（{e.strerror or e.__class__.__name__}）"}
    return {"ok": True, "message": f"可以連到 {host}:{port}（尚未驗證帳號密碼）"}


def _login_problems(connectors: list[dict]) -> list[str]:
    """Real login for every login a rule uses (what 套用 will hand to Toolbox)."""
    out = []
    for c, sid, _, _ in toolbox_config.used_logins(connectors):
        if not db_login.testable(c["kind"]):
            continue
        src = next((s for s in c.get("sources") or [] if s["id"] == sid), None)
        if not src or not src.get("password_secret"):
            continue
        try:
            pw = sm.get(src["password_secret"])
        except Exception as e:  # noqa: BLE001
            out.append(f"「{c['name']}」的帳號「{src['label']}」：讀不到密碼（{e.__class__.__name__}）")
            continue
        ok, msg = db_login.check(c["kind"], c.get("connection") or {}, src["user"], pw)
        if not ok:
            out.append(f"「{c['name']}」的帳號「{src['label']}」：{msg}")
    return out
