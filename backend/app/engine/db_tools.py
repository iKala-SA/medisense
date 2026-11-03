"""Database connectors inside an Agent run (MVP).

The agent lists database connectors in `capabilities.db_connectors`. For each one the model gets two tools: list the tables and
columns, and run one read-only SELECT. BigQuery runs as the signed-in user (their own Google token, engine/bigquery.py); the other
engines log in with the account the admin entered on the connection (engine/db_direct.py). Every call runs the SQL guard, cuts the
rows, de-identifies them and writes an audit record (never the content)."""
import logging

from .. import db
from . import bigquery, db_direct, db_sql, deid
from . import secrets as sm

log = logging.getLogger(__name__)
DIALECT_NAME = {"mssql": "T-SQL (SQL Server)", "mysql": "MySQL", "bigquery": "GoogleSQL (BigQuery)", "postgres": "PostgreSQL"}


class DbError(Exception):
    """Shown to the model as the tool result."""


def _cut(text: str, max_rows: int) -> str:
    rows = [ln for ln in text.splitlines() if ln.strip()]
    if len(rows) >= max_rows:
        return "\n".join(rows[:max_rows]) + f"\n（結果已達 {max_rows} 筆上限，可能還有更多資料）"
    return text if rows else "（沒有符合的資料）"


def _slug(cid: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in cid)[:24]


def connectors_for(db_ids: list[str]) -> list[dict]:
    """The connectors the agent lists that still exist (each = the Firestore doc plus its `id`)."""
    out = []
    for cid in db_ids or []:
        snap = db.client().collection("db_connectors").document(cid).get()
        if snap.exists:
            out.append({**(snap.to_dict() or {}), "id": cid})
    return out


def tool_specs(db_ids: list[str], email: str = "") -> list[dict]:
    """[{name, label, description, props, required, meta}] ready for the agent runtime to wrap as Tools."""
    specs = []
    for c in connectors_for(db_ids):
        slug, dialect, max_rows = _slug(c["id"]), DIALECT_NAME.get(c["kind"], c["kind"]), int(c.get("max_rows") or 100)
        about = f"（資料庫：{c['name']}{'；' + c['description'] if c.get('description') else ''}）"
        specs.append({"name": f"db_{slug}_tables"[:60], "label": f"{c['name']} · 資料表", "description":
                      f"{about}列出可查詢的資料表與欄位。寫 SQL 前先用這個確認表名與欄位名；資料表很多時用 table 參數篩選名稱。",
                      "props": {"table": {"type": "string", "description": "只列出名稱包含這段文字的資料表（可留空）"}}, "required": [],
                      "meta": {"connector_id": c["id"], "kind": "tables"}})
        specs.append({"name": f"db_{slug}_sql"[:60], "label": f"{c['name']} · 查詢", "description":
                      f"{about}用 {dialect} 寫一個唯讀 SELECT 並執行。規則：只能一個 SELECT（可用 WITH）；不可有註解；"
                      f"最多回傳 {max_rows} 筆，需要統計時請用 GROUP BY / COUNT 彙總。被拒絕時依原因修正後重試。",
                      "props": {"sql": {"type": "string", "description": f"{dialect} SELECT 語句"}}, "required": ["sql"],
                      "meta": {"connector_id": c["id"], "kind": "sql"}})
    return specs


def _login(c: dict) -> tuple[str, str]:
    user, secret = c.get("user", ""), c.get("password_secret", "")
    if not user or not secret:
        raise DbError("這個資料庫連線尚未設定帳號密碼")
    return user, sm.get(secret)


def execute(meta: dict, args: dict, *, user_id: str, email: str, agent_id: str) -> tuple[str, str]:
    """-> (text for the model, trace summary)."""
    cid, kind = meta["connector_id"], meta["kind"]
    snap = db.client().collection("db_connectors").document(cid).get()
    if not snap.exists:
        return "[資料庫連接器不存在]", "連接器不存在"
    c = {**(snap.to_dict() or {}), "id": cid}
    ctype, conn, max_rows, name = c["kind"], c.get("connection") or {}, int(c.get("max_rows") or 100), c.get("name", "資料庫")
    detail, ok, rows, err = "", False, 0, ""
    try:
        if kind == "tables":
            match = str(args.get("table") or "").strip()
            detail = f"列出資料表{('：' + match) if match else ''}"
            text = bigquery.schema(conn, match) if ctype == "bigquery" else db_direct.schema(ctype, conn, *_login(c), match=match)
            ok = True
            return text, f"{name} · 資料表"
        try:
            checked = db_sql.guard_readonly(str(args.get("sql", "")), ctype, max_rows)
        except db_sql.SqlRejected as e:
            raise DbError(f"SQL 未通過檢查：{e}") from e
        detail = checked["sql"]
        if ctype == "bigquery":
            text = bigquery.run(conn, checked["sql"], max_rows=max_rows)
        else:
            text = db_direct.run(ctype, conn, *_login(c), checked["sql"], max_rows)
        text = _cut(text, max_rows)
        rows = len([ln for ln in text.splitlines() if ln.strip().startswith("{")])
        ok = True
        return deid.deidentify(text), f"{name} · {rows} 筆"
    except bigquery.BqError as e:
        err = str(e)
        return f"[資料庫] {e}", f"{name} · {'需要 BigQuery 授權' if e.needs_auth else '失敗'}"
    except (DbError, db_direct.DirectError) as e:
        err = str(e)
        return f"[資料庫] {e}", f"{name} · 未執行：{str(e)[:40]}"
    except Exception as e:  # noqa: BLE001 - driver / network failure becomes a visible step result
        log.exception("database tool failed")
        err = f"{e.__class__.__name__}: {e}"[:300]
        return f"[資料庫錯誤] {err}"[:500], f"{name} · 失敗"
    finally:  # who / which connector / which SQL / how many rows — never the content
        db.audit(user_id, "db.query", email, agent_id=agent_id, connector_id=cid, mode=kind, query=detail[:600], rows=rows, ok=ok, error=err)
