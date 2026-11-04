"""SQL guard for model-written queries (MVP): one read-only SELECT, enforced row limit, no dangerous syntax."""
import pytest

from app.engine.db_sql import SqlRejected, guard_readonly


def ok(sql, kind="postgres", rows=100):
    return guard_readonly(sql, kind, rows)["sql"]


def no(sql, kind="postgres", why=""):
    with pytest.raises(SqlRejected) as e:
        guard_readonly(sql, kind, 100)
    assert why in str(e.value), str(e.value)


@pytest.mark.parametrize("sql", [
    "SELECT * FROM public.v_stock",
    "SELECT name, count(*) AS n FROM v_stock GROUP BY name ORDER BY n DESC",
    "WITH a AS (SELECT name, qty FROM v_stock) SELECT name, sum(qty) AS total FROM a GROUP BY name",
    "SELECT s.name, d.head FROM v_stock s JOIN v_dept d ON d.dept = s.name",
    "SELECT name FROM v_stock UNION SELECT dept FROM v_dept",
    "SELECT 'sp_who' AS s FROM v_stock",  # inside a literal: fine
])
def test_valid_selects_pass_and_get_a_row_limit(sql):
    assert ok(sql).endswith("LIMIT 100")


def test_row_limit_per_dialect():
    assert ok("SELECT a FROM t LIMIT 5") == "SELECT a FROM t LIMIT 5"  # a smaller limit is kept
    assert ok("SELECT a FROM t LIMIT 5000") == "SELECT a FROM t LIMIT 100"
    assert ok("SELECT name FROM dbo.t ORDER BY name", "mssql") == "SELECT TOP 100 name FROM dbo.t ORDER BY name"
    assert ok("SELECT a FROM `p.d.t`", "bigquery").endswith("LIMIT 100")


@pytest.mark.parametrize("sql,kind,why", [
    ("", "postgres", "空的"),
    ("DELETE FROM t", "postgres", "只能是 SELECT"),
    ("UPDATE t SET a = 1", "postgres", "只能是 SELECT"),
    ("SELECT 1; DROP TABLE t", "postgres", "一個陳述式"),
    ("SELECT a INTO x FROM t", "postgres", ""),
    ("SELECT a FROM t -- hi", "postgres", "註解"),
    ("SELECT pg_sleep(10)", "postgres", "pg_sleep"),
    ("SELECT pg_read_file('/etc/passwd')", "postgres", "pg_read"),
    ("SELECT * FROM dblink('h', 'select 1') AS x(a int)", "postgres", "dblink"),
    ("EXEC xp_cmdshell 'dir'", "mssql", ""),
    ("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'select 1')", "mssql", ""),
    ("SELECT load_file('/etc/passwd')", "mysql", "load_file"),
    ("SELECT sleep(5)", "mysql", "sleep"),
    ("SELECT a FROM t FOR UPDATE", "postgres", ""),
    ("x" * 5000, "postgres", "太長"),
])
def test_dangerous_or_non_select_sql_is_refused(sql, kind, why):
    no(sql, kind, why)
