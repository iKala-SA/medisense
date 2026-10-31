import pytest

from app.engine.db_sql import SqlRejected, guard_select

from .test_db_connectors import ADMIN, BUILDER, body, groups, secrets  # noqa: F401  (fixtures)

V = [{"name": "public.v_stock", "columns": [{"name": "name"}, {"name": "qty"}, {"name": "code"}, {"name": "patient_id", "sensitive": True}]},
     {"name": "public.v_dept", "columns": [{"name": "dept"}, {"name": "head"}]}]


def ok(sql, kind="postgres", rows=100):
    return guard_select(sql, kind, V, rows)


def no(sql, kind="postgres", why=""):
    with pytest.raises(SqlRejected) as e:
        guard_select(sql, kind, V, 100)
    assert why in str(e.value), str(e.value)


@pytest.mark.parametrize("sql", [
    "SELECT name, qty FROM public.v_stock WHERE code = 'A'",
    "SELECT name, count(*) AS n FROM public.v_stock GROUP BY name ORDER BY n DESC",
    "WITH a AS (SELECT name, qty FROM public.v_stock) SELECT name, sum(qty) AS total FROM a GROUP BY name",
    "SELECT s.name, d.head FROM public.v_stock s JOIN public.v_dept d ON d.dept = s.name",
    "SELECT name FROM public.v_stock WHERE qty > (SELECT avg(qty) FROM public.v_stock)",
    "SELECT name FROM public.v_stock UNION SELECT dept FROM public.v_dept",
    "SELECT coalesce(name, 'x'), round(qty, 1), date_trunc('month', now()) FROM public.v_stock",
])
def test_valid_selects_pass_and_get_a_row_limit(sql):
    assert ok(sql)["sql"].upper().rstrip().endswith("LIMIT 100")


def test_row_limit_is_enforced_but_a_smaller_one_is_kept():
    assert ok("SELECT name FROM public.v_stock LIMIT 5000")["sql"].endswith("LIMIT 100")
    assert ok("SELECT name FROM public.v_stock LIMIT 7")["sql"].endswith("LIMIT 7")
    assert ok("SELECT name FROM public.v_stock", rows=25)["sql"].endswith("LIMIT 25")
    assert "TOP 100" in ok("SELECT name FROM public.v_stock", "mssql")["sql"].upper()
    assert "TOP 100" in ok("SELECT TOP 99999 name FROM public.v_stock", "mssql")["sql"].upper()
    assert ok("SELECT name FROM `public.v_stock`", "bigquery")["sql"].endswith("LIMIT 100")


@pytest.mark.parametrize("sql,why", [
    ("", "空"),
    ("DELETE FROM public.v_stock", "SELECT"),
    ("UPDATE public.v_stock SET qty = 0", "SELECT"),
    ("INSERT INTO public.v_stock VALUES (1)", "SELECT"),
    ("DROP TABLE public.v_stock", "SELECT"),
    ("TRUNCATE public.v_stock", ""),
    ("CREATE TABLE x AS SELECT name FROM public.v_stock", "SELECT"),
    ("SELECT name FROM public.v_stock; DROP TABLE x", "一個陳述式"),
    ("SELECT name FROM public.v_stock; SELECT name FROM public.v_stock", "一個陳述式"),
    ("SELECT name INTO t FROM public.v_stock", "INTO"),
    ("SELECT name FROM public.v_stock FOR UPDATE", "LOCK"),
    ("SELECT name FROM public.v_stock -- hi", "註解"),
    ("SELECT name /* x */ FROM public.v_stock", "註解"),
    ("SELECT name FROM public.v_stock WHERE code = $1", "不允許的語法"),
    ("SELECT name FROM public.v_stock WHERE code = :x", ""),
    ("SELECT * FROM public.v_stock", "*"),
    ("SELECT s.* FROM public.v_stock s", "*"),
    ("SELECT patient_id FROM public.v_stock", "敏感"),
    ("SELECT name FROM public.v_stock WHERE patient_id = 7", "敏感"),
    ("SELECT name FROM public.v_stock ORDER BY patient_id", "敏感"),
    ("SELECT count(patient_id) FROM public.v_stock", "敏感"),
    ("SELECT name FROM public.v_stock GROUP BY name HAVING max(patient_id) > 1", "敏感"),
    ("SELECT qty AS patient_id FROM public.v_stock WHERE patient_id > 0", "敏感"),
    ("SELECT hidden FROM public.v_stock", "不在可查詢"),
    ("SELECT hidden AS hidden FROM public.v_stock", "不在可查詢"),
    ("SELECT hidden + 1 AS hidden FROM public.v_stock", "不在可查詢"),
    ("SELECT name FROM v_stock", "不可存取"),
    ("SELECT name FROM other.v_stock", "不可存取"),
    ("SELECT name FROM pg_catalog.pg_user", "不可存取"),
    ("SELECT name FROM information_schema.columns", "不可存取"),
    ("SELECT name FROM public.v_stock WHERE qty > (SELECT max(x) FROM secret.t)", "不可存取"),
    ("SELECT name FROM public.v_stock JOIN secret.t ON 1=1", "不可存取"),
    ("SELECT name FROM generate_series(1,3) name", "表值函式"),
    ("SELECT pg_sleep(5)", ""),
    ("SELECT name FROM public.v_stock WHERE code = @x", ""),
    ("SELECT name FROM public.v_stock WHERE code = ?", ""),
    ("SELECT name FROM public.v_stock WHERE pg_sleep(5) IS NULL", "不允許的函式"),
    ("SELECT pg_read_file('/etc/passwd') FROM public.v_stock", "不允許的函式"),
    ("SELECT dblink('x','y') FROM public.v_stock", "不允許的函式"),
    ("SELECT lo_import('/etc/passwd') FROM public.v_stock", "不允許的函式"),
    ("SELEC name FROM public.v_stock", ""),
    ("SELECT name FROM public.v_stock WHERE", ""),
    ("SELECT name FROM public.v_stock " + "WHERE qty > 1 " * 400, "太長"),
])
def test_dangerous_or_out_of_scope_sql_is_refused(sql, why):
    no(sql, why=why)


@pytest.mark.parametrize("kind,sql,why", [
    ("mysql", "SELECT sleep(5) FROM public.v_stock", "不允許的函式"),
    ("mysql", "SELECT name FROM public.v_stock WHERE qty > benchmark(10000000, md5('x'))", "不允許的函式"),
    ("mysql", "SELECT load_file('/etc/passwd') FROM public.v_stock", "不允許的函式"),
    ("mysql", "SELECT name FROM public.v_stock # comment", "註解"),
    ("mssql", "SELECT name FROM public.v_stock; EXEC xp_cmdshell 'dir'", ""),
    ("mssql", "SELECT xp_cmdshell('dir') FROM public.v_stock", "不允許的函式"),
    ("mssql", "SELECT name FROM OPENROWSET('x','y','z')", ""),
    ("mssql", "SELECT name FROM public.v_stock WHERE code = @p1", "不允許的語法"),
    ("bigquery", "SELECT name FROM `other.v_stock`", "不可存取"),
    ("bigquery", "SELECT name FROM public.v_stock WHERE code = @code", "不允許的語法"),
    ("bigquery", "SELECT external_query('c', 'select 1') FROM public.v_stock", "不允許的函式"),
])
def test_dialect_specific_attacks(kind, sql, why):
    no(sql, kind, why)


def test_check_sql_endpoint_uses_the_users_own_rule(fs, as_user, secrets):  # noqa: F811
    groups(fs)
    c = as_user(ADMIN)
    cid = c.post("/api/db-connectors", json=body(rules=[{"group_id": "g_pharm", "source_id": "ro_pharm", "queries": [], "views": ["v1"]}])).json()["id"]
    r = c.post(f"/api/db-connectors/{cid}/check-sql", json={"email": BUILDER.email, "sql": "SELECT name FROM public.v_stock"}).json()
    assert r["ok"] and r["sql"].endswith("LIMIT 100")  # the connector's max_rows (default)
    bad = c.post(f"/api/db-connectors/{cid}/check-sql", json={"email": BUILDER.email, "sql": "SELECT patient_id FROM public.v_stock"}).json()
    assert not bad["ok"] and "敏感" in bad["reason"]
    assert not c.post(f"/api/db-connectors/{cid}/check-sql", json={"email": "x@y.org", "sql": "SELECT 1"}).json()["ok"]
    assert as_user(BUILDER).post(f"/api/db-connectors/{cid}/check-sql", json={"email": BUILDER.email, "sql": "SELECT 1"}).status_code == 403
