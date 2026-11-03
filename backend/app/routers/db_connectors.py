"""Database connectors (MVP): admins create a connection, builders attach it to an Agent, anyone using that Agent can query it.

PostgreSQL / MySQL / SQL Server log in with the account entered on the connection (the password goes to Secret Manager and
never comes back). BigQuery takes no account: it runs as the signed-in user with their own Google token."""
import logging
import socket

from fastapi import APIRouter, Depends, Header, HTTPException

from .. import db
from ..auth import User, current_user, require_admin, require_builder
from ..engine import bigquery, db_login
from ..engine import secrets as sm
from ..schemas import DbConnectorIn, DbConnectorOut

router = APIRouter(prefix="/api/db-connectors", tags=["db-connectors"])
log = logging.getLogger(__name__)


def _col():
    return db.client().collection("db_connectors")


def _load(cid: str):
    snap = _col().document(cid).get()
    if not snap.exists:
        raise HTTPException(404, "database connector not found")
    return snap


def _out(doc) -> DbConnectorOut:
    d = doc.to_dict() or {}
    return DbConnectorOut(id=doc.id, name=d.get("name", ""), kind=d.get("kind", ""), description=d.get("description", ""),
                          connection=d.get("connection") or {}, user=d.get("user", ""), password_set=bool(d.get("password_secret")),
                          max_rows=d.get("max_rows", 100), created_by=d.get("created_by", ""), created_at=d.get("created_at"),
                          updated_at=d.get("updated_at"))


def _password(cid: str, body: DbConnectorIn, old: dict | None) -> str:
    """Secret Manager name of the login's password ('' for BigQuery). Omitted on update = keep the stored one."""
    if body.kind == "bigquery":
        return ""
    if body.password:
        return sm.put(cid, "password", body.password)
    if (old or {}).get("password_secret"):
        return old["password_secret"]
    raise HTTPException(422, "請輸入密碼")


@router.get("", response_model=list[DbConnectorOut], dependencies=[Depends(require_admin)])
def list_connectors():
    docs = sorted(_col().stream(), key=lambda d: str((d.to_dict() or {}).get("updated_at") or ""), reverse=True)
    return [_out(d) for d in docs]


@router.get("/catalog")
def catalog(user: User = Depends(require_builder)):
    """Names only, so an Agent builder can attach a database."""
    return sorted(({"id": d.id, "name": (d.to_dict() or {}).get("name", ""), "kind": (d.to_dict() or {}).get("kind", "")} for d in _col().stream()),
                  key=lambda x: x["name"].lower())


@router.get("/mine")
def mine(user: User = Depends(current_user)):
    """Every connection (MVP: no per-group rules): name, kind and description only."""
    out = [{"id": d.id, "name": c.get("name", ""), "kind": c.get("kind", ""), "description": c.get("description", "")}
           for d in _col().stream() if (c := d.to_dict() or {})]
    return sorted(out, key=lambda x: x["name"].lower())


@router.get("/{cid}", response_model=DbConnectorOut, dependencies=[Depends(require_admin)])
def get_connector(cid: str):
    return _out(_load(cid))


@router.post("", response_model=DbConnectorOut, status_code=201)
def create_connector(body: DbConnectorIn, user: User = Depends(require_admin)):
    ref = _col().document()
    ref.set({**body.model_dump(exclude={"password"}), "password_secret": _password(ref.id, body, None),
             "created_by": user.email, "created_at": db.now(), "updated_at": db.now()})
    db.audit(user.uid, "db_connector.create", user.email, connector_id=ref.id, name=body.name, kind=body.kind)
    return _out(ref.get())


@router.put("/{cid}", response_model=DbConnectorOut)
def update_connector(cid: str, body: DbConnectorIn, user: User = Depends(require_admin)):
    snap = _load(cid)
    old = snap.to_dict() or {}
    if body.kind != old.get("kind"):
        raise HTTPException(422, "the database kind cannot be changed")
    secret = _password(cid, body, old)
    snap.reference.set({**old, **body.model_dump(exclude={"password"}), "password_secret": secret, "updated_at": db.now()})
    db.audit(user.uid, "db_connector.update", user.email, connector_id=cid, name=body.name, password_changed=bool(body.password))
    return _out(snap.reference.get())


@router.delete("/{cid}", status_code=204)
def delete_connector(cid: str, user: User = Depends(require_admin)):
    snap = _load(cid)
    d = snap.to_dict() or {}
    for s in [d.get("password_secret"), *(x.get("password_secret") for x in d.get("sources") or [])]:  # `sources`: pre-MVP docs
        if s:
            sm.delete(s)
    snap.reference.delete()
    db.audit(user.uid, "db_connector.delete", user.email, connector_id=cid, name=d.get("name", ""))


def _test(kind: str, conn: dict, user: str, password: str, bq_token: str | None) -> dict:
    if kind == "bigquery":
        if not bq_token:
            return {"ok": None, "message": "BigQuery 以你自己的 Google 帳號測試：請先點「授權 BigQuery」"}
        try:
            with bigquery.user_token(bq_token):
                tables = bigquery.schema(conn)
        except bigquery.BqError as e:
            return {"ok": False, "message": str(e)}
        n = sum(1 for ln in tables.splitlines() if ln.startswith("- "))
        return {"ok": True, "message": f"連線成功：你的帳號可以看到 {n} 個資料表"}
    host, port = str(conn.get("host", "")).strip(), str(conn.get("port", "")).strip()
    if not (host and port.isdigit() and 0 < int(port) < 65536):
        return {"ok": False, "message": "請填寫主機與連接埠"}
    if user and password:
        ok, msg = db_login.check(kind, {**conn, "host": host, "port": port}, user, password)
        return {"ok": ok, "message": msg}
    try:
        socket.create_connection((host, int(port)), timeout=5).close()
    except OSError as e:
        return {"ok": False, "message": f"無法連到 {host}:{port}（{e.strerror or e.__class__.__name__}）"}
    return {"ok": True, "message": f"可以連到 {host}:{port}（尚未驗證帳號密碼）"}


@router.post("/test-connection", dependencies=[Depends(require_admin)])
def test_connection(body: dict, x_bigquery_auth: str | None = Header(None)):
    """驗證連線 before saving: a real login (or, without a password, a TCP reachability check); BigQuery lists the tables the
    admin's own Google account can see."""
    return _test(str(body.get("kind", "")), body.get("connection") or {}, str(body.get("user") or ""), str(body.get("password") or ""),
                 x_bigquery_auth)


@router.post("/{cid}/test", dependencies=[Depends(require_admin)])
def test_saved(cid: str, x_bigquery_auth: str | None = Header(None)):
    """驗證連線 for a saved connection, with its stored password."""
    d = _load(cid).to_dict() or {}
    pw = sm.get(d["password_secret"]) if d.get("password_secret") else ""
    return _test(d.get("kind", ""), d.get("connection") or {}, d.get("user", ""), pw, x_bigquery_auth)
