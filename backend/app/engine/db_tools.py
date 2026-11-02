"""Database connectors inside an Agent run (docs/DB-CONNECTORS-DESIGN.md §2–4).

The agent lists database connectors in `capabilities.db_connectors`; what the model may call is decided per run from the
EXECUTING user's group rules (sharing an agent never shares data; scheduled runs use the schedule owner). The model gets one tool per
granted predefined query (A) and one `*_sql` tool per connector whose rule opens views (B). Every call re-checks the grant,
runs the SQL guard (B), calls Toolbox with the login the rule names, de-identifies the rows and writes an audit record."""
import json
import logging

from .. import db, sharing
from ..config import settings
from . import db_access, db_sql, deid, toolbox_config

log = logging.getLogger(__name__)
MAX_VIEWS_IN_PROMPT = 12


class DbError(Exception):
    """Shown to the model as the tool result."""


def _toolbox_call(tool: str, args: dict) -> str:
    """One Toolbox tool call over MCP (Cloud Run IAM: an ID token for the Toolbox URL)."""
    from . import connectors
    from .llm import _id_token

    url = settings().toolbox_url.rstrip("/")
    if not url:
        raise DbError("資料庫查詢尚未啟用（後端未設定 Toolbox）")
    headers = {}
    if (tok := _id_token(url)):
        headers["Authorization"] = f"Bearer {tok}"
    c = connectors.McpClient(url + "/mcp", headers)
    c.initialize()
    return c.call_tool(tool, args)


def _cut(text: str, max_rows: int) -> str:
    """Toolbox returns one JSON object per row; keep at most max_rows of them."""
    rows = [ln for ln in text.splitlines() if ln.strip()]
    if len(rows) > max_rows:
        return "\n".join(rows[:max_rows]) + f"\n（結果超過 {max_rows} 筆，已截斷）"
    return text if rows else "（沒有符合的資料）"


def _slug(cid: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in cid)[:24]


def grants_for(db_ids: list[str], email: str) -> list[tuple[dict, dict]]:
    """[(connector, grant)] for the connectors the agent lists and this e-mail may use."""
    if not db_ids or not email:
        return []
    groups = sharing.group_ids_of(email)
    out = []
    for cid in db_ids:
        snap = db.client().collection("db_connectors").document(cid).get()
        if not snap.exists:
            continue
        c = {**(snap.to_dict() or {}), "id": cid}
        if (g := db_access.grant(c, email, groups)):
            out.append((c, g))
    return out


def tool_specs(db_ids: list[str], email: str) -> list[dict]:
    """[{name, label, description, props, required, meta}] ready for the agent runtime to wrap as Tools."""
    specs = []
    for c, g in grants_for(db_ids, email):
        slug = _slug(c["id"])
        for q in g["queries"]:
            props = {p["name"]: {"type": {"integer": "integer", "float": "number", "boolean": "boolean"}.get(p.get("type"), "string"),
                                 "description": p.get("description") or p["name"]} for p in q.get("parameters") or []}
            req = [p["name"] for p in q.get("parameters") or [] if p.get("required", True)]
            specs.append({"name": f"db_{slug}_{q['id']}"[:60], "label": f"{c['name']} · {q['name']}",
                          "description": f"（資料庫：{c['name']}）{q.get('description') or q['name']}", "props": props, "required": req,
                          "meta": {"connector_id": c["id"], "kind": "query", "qid": q["id"]}})
        if g["views"]:
            dialect = {"mssql": "T-SQL", "cloud_sql_mssql": "T-SQL", "mysql": "MySQL", "cloud_sql_mysql": "MySQL", "bigquery": "GoogleSQL"}.get(c["kind"], "PostgreSQL")
            lines = []
            for v in g["views"][:MAX_VIEWS_IN_PROMPT]:
                cols = "、".join(f"{x['name']}{f'({x['type']})' if x.get('type') else ''}" for x in v["columns"] if not x.get("sensitive"))
                lines.append(f"- {v['name']}：{v.get('description') or ''} 欄位：{cols}")
                for ex in (v.get("examples") or [])[:2]:
                    lines.append(f"  例：{ex.get('question', '')} → {ex.get('sql', '')}")
            desc = (f"（資料庫：{c['name']}）用 {dialect} 寫一個唯讀 SELECT 查詢下列檢視表。規則：只能一個 SELECT；不可用 *、註解、參數佔位符；"
                    f"只能用下列欄位；最多回傳 {c.get('max_rows') or 100} 筆。若被拒絕，依錯誤原因修正後重試。\n可查詢的檢視表：\n" + "\n".join(lines))
            specs.append({"name": f"db_{slug}_sql"[:60], "label": f"{c['name']} · 自然語言查詢", "description": desc,
                          "props": {"sql": {"type": "string", "description": f"{dialect} SELECT 語句"}}, "required": ["sql"],
                          "meta": {"connector_id": c["id"], "kind": "sql"}})
    return specs


def execute(meta: dict, args: dict, *, user_id: str, email: str, agent_id: str) -> tuple[str, str]:
    """-> (text for the model, trace summary). Re-checks the grant at call time."""
    cid, kind = meta["connector_id"], meta["kind"]
    snap = db.client().collection("db_connectors").document(cid).get()
    if not snap.exists:
        return "[資料庫連接器不存在]", "連接器不存在"
    c = {**(snap.to_dict() or {}), "id": cid}
    g = db_access.grant(c, email, sharing.group_ids_of(email))
    detail, ok, rows, err = "", False, 0, ""
    try:
        if not g:
            raise DbError("你沒有使用這個資料庫的權限")
        sid, ctype = g["source_id"], c["kind"]
        if ctype == "bigquery":
            raise DbError("BigQuery 查詢需要使用者的 Google 授權，尚未開放")
        if kind == "query":
            q = next((x for x in g["queries"] if x["id"] == meta["qid"]), None)
            if not q:
                raise DbError("這個查詢沒有開放給你")
            call = {p["name"]: args[p["name"]] for p in q.get("parameters") or [] if args.get(p["name"]) not in (None, "")}
            missing = [p["name"] for p in q.get("parameters") or [] if p.get("required", True) and p["name"] not in call]
            if missing:
                raise DbError(f"缺少參數：{'、'.join(missing)}")
            detail = q["name"]
            text = _toolbox_call(toolbox_config.query_tool(cid, sid, q["id"]), call)
        else:
            try:
                checked = db_sql.guard_select(str(args.get("sql", "")), ctype, g["views"], int(c.get("max_rows") or 100))
            except db_sql.SqlRejected as e:
                raise DbError(f"SQL 未通過檢查：{e}") from e
            detail = checked["sql"]
            text = _toolbox_call(toolbox_config.sql_tool(cid, sid), {"sql": checked["sql"]})
        text = _cut(text, int(c.get("max_rows") or 100))
        rows = len([ln for ln in text.splitlines() if ln.strip().startswith("{")])
        ok = True
        return deid.deidentify(text), f"{c.get('name', '')} · {meta.get('qid') or '自然語言查詢'} · {rows} 筆"
    except DbError as e:
        err = str(e)
        return f"[資料庫] {e}", f"{c.get('name', '資料庫')} · 未執行：{str(e)[:40]}"
    except Exception as e:  # noqa: BLE001 - driver / network failure becomes a visible step result
        err = f"{e.__class__.__name__}: {e}"[:300]
        return f"[資料庫錯誤] {err}"[:500], f"{c.get('name', '資料庫')} · 失敗"
    finally:  # who / which connector / which rule / which query or SQL / how many rows — never the content
        db.audit(user_id, "db.query", email, agent_id=agent_id, connector_id=cid, mode=kind, rule=(g or {}).get("rule"),
                 query=detail[:600], rows=rows, ok=ok, error=err)
