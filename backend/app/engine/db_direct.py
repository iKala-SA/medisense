"""PostgreSQL / MySQL / SQL Server queries with the connector's own login (MVP: no Toolbox, no per-group logins).

Every query runs in a read-only session with a statement timeout where the engine supports one, and at most `max_rows` rows
are fetched. The account itself should still be a read-only login (the DBA checklist) — that is the real boundary.
Rows come back as one JSON object per line, the same shape BigQuery results use."""
import json

from .db_login import _reason

TIMEOUT_S = 30
CONNECT_S = 5


class DirectError(Exception):
    """Shown to the model."""


def _lines(cols: list[str], rows) -> str:
    return "\n".join(json.dumps(dict(zip(cols, r)), ensure_ascii=False, default=str) for r in rows)


def run(kind: str, conn: dict, user: str, password: str, sql: str, max_rows: int) -> str:
    host, port, dbname, ssl = conn.get("host", ""), int(conn.get("port") or 0), conn.get("database", ""), conn.get("ssl") == "true"
    try:
        if kind == "postgres":
            import psycopg
            with psycopg.connect(host=host, port=port, dbname=dbname, user=user, password=password, connect_timeout=CONNECT_S,
                                 sslmode="require" if ssl else "prefer",
                                 options=f"-c default_transaction_read_only=on -c statement_timeout={TIMEOUT_S * 1000}") as c:
                cur = c.execute(sql)
                return _lines([d.name for d in cur.description or []], cur.fetchmany(max_rows))
        if kind == "mysql":
            import pymysql
            c = pymysql.connect(host=host, port=port, database=dbname, user=user, password=password, connect_timeout=CONNECT_S,
                                read_timeout=TIMEOUT_S + 5, ssl={} if ssl else None)
            try:
                with c.cursor() as cur:
                    cur.execute("SET SESSION TRANSACTION READ ONLY")
                    try:
                        cur.execute(f"SET SESSION max_execution_time = {TIMEOUT_S * 1000}")  # MySQL 5.7.8+
                    except pymysql.MySQLError:
                        cur.execute(f"SET SESSION max_statement_time = {TIMEOUT_S}")  # MariaDB
                    cur.execute(sql)
                    return _lines([d[0] for d in cur.description or []], cur.fetchmany(max_rows))
            finally:
                c.close()
        if kind == "mssql":
            import pytds
            # `timeout` is the per-request timeout: on expiry the driver cancels the request and the server stops the query.
            with pytds.connect(server=host, port=port, database=dbname, user=user, password=password, login_timeout=CONNECT_S,
                               timeout=TIMEOUT_S, validate_host=False, enc_login_only=not ssl, autocommit=False) as c:
                with c.cursor() as cur:
                    cur.execute("SET LOCK_TIMEOUT 5000")
                    cur.execute(sql)
                    rows = cur.fetchmany(max_rows)
                    cols = [d[0] for d in cur.description or []]
                c.rollback()
                return _lines(cols, rows)
    except Exception as e:  # noqa: BLE001 - any driver failure is a message the model (and the admin) can act on
        low = str(e).lower()
        if "statement timeout" in low or "max_execution_time" in low or "timed out" in low or "timeout" in low:
            raise DirectError(f"查詢超過 {TIMEOUT_S} 秒，已中止；請縮小範圍（加上條件或彙總）") from e
        raise DirectError(_reason(e)) from e
    raise DirectError("不支援的資料庫類型")


SCHEMA_SQL = {
    "postgres": "SELECT table_schema || '.' || table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position",
    "mysql": "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = DATABASE() "
             "ORDER BY table_name, ordinal_position",
    "mssql": "SELECT TABLE_SCHEMA + '.' + TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
             "ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
}


def describe(rows: list[tuple[str, str, str]], match: str = "", max_chars: int = 12000) -> str:
    """[(table, column, type)] -> 'table: col(type), …' lines; `match` keeps tables whose name contains it."""
    tables: dict[str, list[str]] = {}
    for t, c, ty in rows:
        if match and match.lower() not in str(t).lower():
            continue
        tables.setdefault(str(t), []).append(f"{c}({str(ty).lower()})")
    if not tables:
        return "（找不到符合的資料表）" if match else "（這個帳號看不到任何資料表）"
    out, size = [], 0
    for t, cols in tables.items():
        line = f"- {t}：{', '.join(cols)}"
        if size + len(line) > max_chars:
            out.append(f"（還有 {len(tables) - len(out)} 個資料表未列出，請用 table 參數篩選）")
            break
        out.append(line)
        size += len(line)
    return "\n".join(out)


def schema(kind: str, conn: dict, user: str, password: str, match: str = "") -> str:
    text = run(kind, conn, user, password, SCHEMA_SQL[kind], max_rows=20000)
    rows = [tuple(json.loads(ln).values()) for ln in text.splitlines() if ln.strip()]
    return describe(rows, match)
