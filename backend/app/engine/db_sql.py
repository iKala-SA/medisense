"""Guard for model-written SQL on a database connector (MVP: no registered views or rules).

Parsed with sqlglot (not string matching). This is NOT the main defence — that is the database account, which should be a
read-only login — it stops obviously wrong or dangerous SQL before it is sent, enforces the row limit and gives the model a reason
to correct itself."""
import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

DIALECT = {"postgres": "postgres", "mysql": "mysql", "mssql": "tsql", "bigquery": "bigquery"}
MAX_SQL = 4000
_FORBIDDEN_NODES = (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Into, exp.Lock,
                    exp.Set, exp.Copy, exp.Use, exp.Placeholder, exp.Parameter, exp.SessionParameter, exp.Pragma, exp.Transaction)


class SqlRejected(Exception):
    """Raised with a reason the model (or admin) can act on."""


def _reject(msg: str):
    raise SqlRejected(msg)


def _table_name(t: exp.Table) -> str:
    return ".".join(p.name.lower() for p in (t.args.get("catalog"), t.args.get("db"), t.this) if p is not None and hasattr(p, "name"))


# functions that read files, sleep, reach other servers or run code — refused by name in every dialect
_DANGEROUS = re.compile(r"^(pg_sleep\w*|pg_read\w*|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|pg_terminate_backend|pg_cancel_backend|set_config|"
                        r"sleep|benchmark|load_file|sys_exec|sys_eval|get_lock|"
                        r"xp_\w+|sp_\w+|openrowset|opendatasource|openquery|openjson_unsafe|"
                        r"external_query|ml\.\w+)$", re.I)

_RAW_DANGEROUS = re.compile(r"\b(waitfor|xp_\w+|sp_\w+|pg_sleep\w*|pg_read\w*|dblink\w*|openrowset|opendatasource|openquery|load_file|benchmark)\b", re.I)


def guard_readonly(sql: str, kind: str, max_rows: int = 100) -> dict:
    """Validate model-written SQL: one read-only SELECT, no comments, no write / session syntax, no dangerous functions.
    -> {"sql": SQL with the row limit enforced, "tables": [...]} or raises SqlRejected."""
    dialect = DIALECT.get(kind)
    if not dialect:
        _reject("不支援的資料庫類型")
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        _reject("SQL 是空的")
    if len(sql) > MAX_SQL:
        _reject(f"SQL 太長（上限 {MAX_SQL} 字元）")
    try:
        tokens = sqlglot.tokenize(sql, read=dialect)
        stmts = [s for s in sqlglot.parse(sql, read=dialect) if s is not None]
    except SqlglotError as e:
        _reject(f"無法解析 SQL：{str(e).splitlines()[0][:160]}")
    if any(t.comments for t in tokens):
        _reject("SQL 不可包含註解")
    if len(stmts) != 1:
        _reject("只能有一個陳述式")
    root = stmts[0]
    if not isinstance(root, (exp.Select, exp.SetOperation)) or not root.find(exp.Select):
        _reject("只能是 SELECT 查詢")
    if (bad := root.find(*_FORBIDDEN_NODES)):
        _reject(f"不允許的語法：{bad.key.upper()}")
    for f in root.find_all(exp.Func):
        name = f.name if isinstance(f, exp.Anonymous) else (f.sql_name() if hasattr(f, "sql_name") else f.key)
        if _DANGEROUS.match(str(name)):
            _reject(f"不允許的函式：{name}")
    if (m := _RAW_DANGEROUS.search(re.sub(r"'(?:[^']|'')*'", "''", sql))):  # whatever sqlglot parsed it as (string literals ignored)
        _reject(f"不允許的語法：{m.group(0)}")
    tables = sorted({_table_name(t) for t in root.find_all(exp.Table) if isinstance(t.this, exp.Identifier)})
    limit = max(1, int(max_rows))
    cur = root.args.get("limit")
    n = cur.expression if cur is not None and isinstance(cur, exp.Limit) else None
    if not (isinstance(n, exp.Literal) and n.is_int and int(n.name) <= limit):
        root = root.limit(limit, copy=False)
    return {"sql": root.sql(dialect=dialect), "tables": tables}
