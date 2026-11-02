"""A real login attempt for postgres / mysql / mssql sources (the same host, port, database, login Toolbox will use).

Used by the 建立 dialog's 驗證連線 and before 套用, so a wrong password is reported at once and by name instead of as a failed
Cloud Run revision. Cloud SQL (reached through the Cloud SQL connector) and BigQuery (the user's own identity) are not tested here."""
import logging

log = logging.getLogger(__name__)
TIMEOUT = 5
PLAIN = ("postgres", "mysql", "mssql")


def testable(kind: str) -> bool:
    return kind in PLAIN


def _reason(e: Exception) -> str:
    text = " ".join(str(e).split())
    low = text.lower()
    if "password authentication failed" in low or "access denied" in low or "login failed" in low:
        return "帳號或密碼錯誤"
    if "does not exist" in low or "unknown database" in low or "cannot open database" in low:
        return "找不到這個資料庫名稱，或此帳號無權進入"
    if "timeout" in low or "timed out" in low:
        return "連線逾時（檢查主機、連接埠與防火牆）"
    if "refused" in low or "no route" in low or "name or service" in low or "nodename" in low or "unknown host" in low:
        return "連不到主機（檢查主機、連接埠與網路）"
    if "ssl" in low or "tls" in low:
        return "SSL 連線失敗：" + text[:120]
    return text[:160]


def check(kind: str, conn: dict, user: str, password: str) -> tuple[bool, str]:
    """-> (ok, message). Never raises, never includes the password."""
    host, port, dbname, ssl = conn.get("host", ""), int(conn.get("port") or 0), conn.get("database", ""), conn.get("ssl") == "true"
    try:
        if kind == "postgres":
            import psycopg
            with psycopg.connect(host=host, port=port, dbname=dbname, user=user, password=password, connect_timeout=TIMEOUT,
                                 sslmode="require" if ssl else "prefer") as c:
                c.execute("select 1")
        elif kind == "mysql":
            import pymysql
            pymysql.connect(host=host, port=port, database=dbname, user=user, password=password, connect_timeout=TIMEOUT,
                            ssl={} if ssl else None).close()
        elif kind == "mssql":
            import pytds
            pytds.connect(server=host, port=port, database=dbname, user=user, password=password, login_timeout=TIMEOUT, timeout=TIMEOUT,
                          validate_host=False, enc_login_only=not ssl).close()
        else:
            return True, "此類型無法在此預先驗證，將於套用時連線"
    except Exception as e:  # noqa: BLE001 - any driver failure is a message for the admin
        return False, _reason(e)
    return True, f"登入成功（{user}@{host}:{port}/{dbname}）"
