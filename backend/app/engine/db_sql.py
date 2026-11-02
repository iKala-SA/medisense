"""Basic checks for administrator-written queries (A). The full guard for model-written SQL (B) is added in the next step."""
import re

_FORBIDDEN = re.compile(r"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call|into|copy|set|declare|"
                        r"pg_sleep|waitfor|xp_\w+|sp_\w+)\b", re.I)


def strip_literals(sql: str) -> str:
    """The statement with string literals and comments blanked, so keywords inside them do not count."""
    out = re.sub(r"'(?:[^']|'')*'", "''", sql)
    out = re.sub(r'"(?:[^"]|"")*"', '""', out)
    out = re.sub(r"--[^\n]*", " ", out)
    return re.sub(r"/\*.*?\*/", " ", out, flags=re.S)


def check_query(statement: str, kind: str, n_params: int, param_names: tuple | list = ()) -> str:
    """'' when acceptable, else the reason. One read-only SELECT / WITH, no template syntax, placeholders match the parameters."""
    if "{{" in statement or "}}" in statement:
        return "不可使用 template 語法（有 SQL injection 風險）"
    bare = strip_literals(statement).strip().rstrip(";").strip()
    if ";" in bare:
        return "只能有一個陳述式"
    if not re.match(r"^(select|with)\b", bare, re.I):
        return "只能是 SELECT 或 WITH 查詢"
    if (m := _FORBIDDEN.search(bare)):
        return f"不允許的關鍵字：{m.group(0)}"
    if "${" in statement:
        return "不可包含 ${…}"
    if kind in ("mssql", "cloud_sql_mssql", "bigquery"):  # Toolbox binds these by name: @code
        named = set(re.findall(r"@([A-Za-z_]\w*)", bare))
        if named != set(param_names):
            return f"參數佔位必須是 @名稱，且與參數一致（SQL 用到 {sorted(named) or '無'}，參數為 {sorted(param_names)}）"
        if "?" in bare:
            return "不可混用 ? 與 @名稱"
    if kind in ("postgres", "cloud_sql_postgres"):
        nums = sorted({int(x) for x in re.findall(r"\$(\d+)", bare)})
        if nums != list(range(1, n_params + 1)):
            return f"參數佔位 $1…${n_params} 必須與參數數量一致"
    elif kind in ("mysql", "cloud_sql_mysql"):
        if bare.count("?") != n_params:
            return f"參數佔位 ? 的數量（{bare.count('?')}）必須等於參數數量（{n_params}）"
    return ""


# ---- B: guard for model-written SQL --------------------------------------------------------------------------------
# Parsed with sqlglot (not string matching). This is NOT the main defence — that is the database role, which can only read the
# registered views — it stops obviously wrong SQL before it is sent and gives the model a reason to correct itself.
import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

DIALECT = {"postgres": "postgres", "cloud_sql_postgres": "postgres", "mysql": "mysql", "cloud_sql_mysql": "mysql",
           "mssql": "tsql", "cloud_sql_mssql": "tsql", "bigquery": "bigquery"}
MAX_SQL = 4000
_FORBIDDEN_NODES = (exp.Insert, exp.Update, exp.Delete, exp.Merge, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Into, exp.Lock,
                    exp.Set, exp.Copy, exp.Use, exp.Placeholder, exp.Parameter, exp.SessionParameter, exp.Pragma, exp.Transaction)
# typed sqlglot functions that are harmless (anything else typed, and any unknown by name, is refused)
_TYPED_OK = {"count", "sum", "avg", "min", "max", "round", "lower", "upper", "length", "substring", "trim", "concat", "concatws", "abs",
             "ceil", "floor", "coalesce", "nullif", "if", "cast", "trycast", "extract", "currentdate", "currenttimestamp", "timestamptrunc",
             "datetrunc", "datediff", "dateadd", "datesub", "timetostr", "tsordstotimestamp", "tsordstodate", "date", "year", "month", "day",
             "rownumber", "rank", "denserank", "lag", "lead", "firstvalue", "lastvalue", "left", "right", "replace", "initcap", "greatest",
             "least", "sqrt", "power", "mod", "stddev", "variance", "countif", "arrayagg", "groupconcat", "stringagg", "timestrtotime",
             "strtodate", "datestrtodate", "dpipe", "iff"}
_ANON_OK = {"now", "getdate", "isnull", "ifnull", "nvl", "len", "datepart", "datename", "curdate", "to_char", "date_format", "date_diff",
            "format_date", "safe_divide", "timestamp_trunc", "date_trunc", "age", "trunc", "string_agg"}


class SqlRejected(Exception):
    """Raised with a reason the model (or admin) can act on."""


def _reject(msg: str):
    raise SqlRejected(msg)


def _norm(name: str) -> str:
    return name.strip().strip('`"[]').lower()


def _table_name(t: exp.Table) -> str:
    return ".".join(p.name.lower() for p in (t.args.get("catalog"), t.args.get("db"), t.this) if p is not None and hasattr(p, "name"))


def guard_select(sql: str, kind: str, views: list[dict], max_rows: int = 100) -> dict:
    """Validate model-written SQL against the registered `views` (dicts: name, columns[{name, sensitive}]). Returns
    {"sql": rewritten SQL with the row limit enforced, "tables": [...], "columns": [...]} or raises SqlRejected."""
    dialect = DIALECT.get(kind)
    if not dialect:
        _reject("不支援的資料庫類型")
    sql = (sql or "").strip()
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
    leaves = list(root.find_all(exp.Select)) if isinstance(root, (exp.Select, exp.SetOperation, exp.Subquery)) else []
    if not leaves:
        _reject("只能是 SELECT 查詢")
    if isinstance(root, exp.Subquery):
        _reject("只能是 SELECT 查詢")
    if (bad := root.find(*_FORBIDDEN_NODES)):
        _reject(f"不允許的語法：{bad.key.upper()}")

    by_name = {_norm(v["name"]): v for v in views}
    ctes = {_norm(c.alias) for c in root.find_all(exp.CTE)}
    used: list[dict] = []
    tables: list[str] = []
    for t in root.find_all(exp.Table):
        if not isinstance(t.this, exp.Identifier):
            _reject("不可使用表值函式或子查詢以外的資料來源")
        full = _table_name(t)
        if "." not in full and full in ctes:
            continue
        v = by_name.get(full)
        if v is None:
            _reject(f"不可存取「{full}」，只能查詢已登記的檢視表：{'、'.join(sorted(by_name)) or '（無）'}")
        if v not in used:
            used.append(v)
        tables.append(full)
    if not used:
        _reject("查詢必須使用至少一個已登記的檢視表")

    sensitive = {_norm(c["name"]) for v in views for c in v.get("columns", []) if c.get("sensitive")}
    visible = {_norm(c["name"]) for v in used for c in v.get("columns", []) if not c.get("sensitive")}
    # an alias only counts when its own expression does not read a column of the same name (`hidden AS hidden` must not pass)
    aliases = {_norm(a.alias) for a in root.find_all(exp.Alias)
               if a.alias and not any(_norm(c.name) == _norm(a.alias) for c in a.this.find_all(exp.Column))}
    cols: list[str] = []
    for star in root.find_all(exp.Star):
        if not isinstance(star.parent, exp.Count):
            _reject("不可使用 *，請明確列出需要的欄位")
    for c in root.find_all(exp.Column):
        n = _norm(c.name)
        if n in sensitive and n not in visible:
            _reject(f"欄位「{c.name}」為敏感欄位，不可查詢")
        if n not in visible and n not in aliases:
            _reject(f"欄位「{c.name}」不在可查詢的欄位內：{'、'.join(sorted(visible))}")
        cols.append(n)
    for f in root.find_all(exp.Func):
        if isinstance(f, exp.Anonymous):
            if f.name.lower() not in _ANON_OK:
                _reject(f"不允許的函式：{f.name}")
        elif f.key not in _TYPED_OK:
            _reject(f"不允許的函式：{f.key}")

    limit = max(1, int(max_rows))
    cur = root.args.get("limit")
    n = cur.expression if cur is not None and isinstance(cur, exp.Limit) else None
    if not (isinstance(n, exp.Literal) and n.is_int and int(n.name) <= limit):
        root = root.limit(limit, copy=False)
    out = root.sql(dialect=dialect)
    return {"sql": out, "tables": tables, "columns": sorted(set(cols))}
