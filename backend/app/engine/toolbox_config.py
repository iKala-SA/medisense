"""Render the admin's database connectors into an MCP Toolbox `tools.yaml` (docs/DB-CONNECTORS-DESIGN.md §7).

Only what a rule actually grants is rendered: a source per (connector, login) that some rule uses, a `*-sql` tool per
(login, predefined query) pair, and one `*-execute-sql` tool per login whose rules open views (B; the backend runs the SQL
guard before calling it, and Toolbox itself must stay unreachable except for the backend). Passwords never appear: the YAML
holds `${DBPW_n}` and `required_secrets()` says which Secret Manager secret each variable is mounted from.
Tool names are `<connector>__<login>__<query>` / `<connector>__<login>__sql`, so the backend can address them without a table."""
import yaml

SOURCE_TYPE = {"postgres": "postgres", "mysql": "mysql", "mssql": "mssql", "cloud_sql_postgres": "cloud-sql-postgres",
               "cloud_sql_mysql": "cloud-sql-mysql", "cloud_sql_mssql": "cloud-sql-mssql", "bigquery": "bigquery"}
FAMILY = {"postgres": "postgres", "cloud_sql_postgres": "postgres", "mysql": "mysql", "cloud_sql_mysql": "mysql",
          "mssql": "mssql", "cloud_sql_mssql": "mssql", "bigquery": "bigquery"}  # tool type = f"{family}-sql" / f"{family}-execute-sql"
BQ_AUTH_HEADER = "X-BigQuery-Auth"  # BigQuery runs as the signed-in user: the backend forwards their short-lived token in this header
QUERY_TIMEOUT = "30s"  # mysql / cloud-sql-mysql only; the other engines rely on the database role (see the DBA checklist)

_SRC_FIELDS = {"postgres": ("host", "port", "database"), "mysql": ("host", "port", "database"), "mssql": ("host", "port", "database"),
               "cloud_sql_postgres": ("project", "region", "instance", "database"), "cloud_sql_mysql": ("project", "region", "instance", "database"),
               "cloud_sql_mssql": ("project", "region", "instance", "database")}


def source_name(cid: str, sid: str) -> str:
    return f"{cid}__{sid or 'bq'}"


def query_tool(cid: str, sid: str, qid: str) -> str:
    return f"{cid}__{sid or 'bq'}__{qid}"


def sql_tool(cid: str, sid: str) -> str:
    return f"{cid}__{sid or 'bq'}__sql"


def _used(connectors: list[dict]):
    """Yield (connector, source_id, query_ids, wants_views) for each login a rule uses (BigQuery: source_id '')."""
    for c in connectors:
        seen: dict[str, dict] = {}
        for r in c.get("rules") or []:
            if not (r.get("queries") or r.get("views")):
                continue
            e = seen.setdefault(r.get("source_id") or "", {"queries": [], "views": False})
            e["queries"] += [q for q in r.get("queries") or [] if q not in e["queries"]]
            e["views"] = e["views"] or bool(r.get("views"))
        for sid in sorted(seen):
            yield c, sid, seen[sid]["queries"], seen[sid]["views"]


def used_logins(connectors: list[dict]):
    """(connector, source_id, query_ids, wants_views) for every login a rule uses."""
    return list(_used(connectors))


def _plan(connectors: list[dict]):
    """Deterministic list of (env, secret_id, connector_id, source_id) and the used logins."""
    used = list(_used(connectors))
    envs = {}
    for c, sid, _, _ in used:
        if c["kind"] == "bigquery":
            continue
        src = next((s for s in c.get("sources") or [] if s["id"] == sid), None)
        if src and src.get("password_secret"):
            envs[(c["id"], sid)] = (f"DBPW_{len(envs) + 1}", src["password_secret"].rsplit("/", 1)[-1])
    return used, envs


def required_secrets(connectors: list[dict]) -> list[dict]:
    """`[{env, secret}]` for `--set-secrets ENV=secret:latest` in infra/13-deploy-toolbox.sh."""
    return [{"env": e, "secret": s} for e, s in _plan(connectors)[1].values()]


def _source(c: dict, sid: str, env: str | None) -> dict:
    kind, conn = c["kind"], c.get("connection") or {}
    out: dict = {"kind": "source", "name": source_name(c["id"], sid), "type": SOURCE_TYPE[kind]}
    if kind == "bigquery":
        out.update(project=conn["project"], location=conn.get("location") or "asia-east1", writeMode="blocked", useClientOAuth=BQ_AUTH_HEADER,
                   maxQueryResultRows=int(c.get("max_rows") or 100))
        if conn.get("datasets"):
            out["allowedDatasets"] = [d.strip() for d in conn["datasets"].split(",") if d.strip()]
        return out
    src = next(s for s in c["sources"] if s["id"] == sid)
    for k in _SRC_FIELDS[kind]:
        out[k] = str(conn[k])
    out.update(user=src["user"], password="${%s}" % env)
    if kind.startswith("cloud_sql") and conn.get("ip_type"):
        out["ipType"] = conn["ip_type"]
    if FAMILY[kind] == "mysql":
        out["queryTimeout"] = QUERY_TIMEOUT
    if conn.get("ssl") == "true" and not kind.startswith("cloud_sql"):  # Cloud SQL connections are always encrypted
        # "Encrypt, do not verify the certificate" for every engine (hospital databases often use an internal CA).
        # postgres sslmode=require: verified on Cloud SQL. mysql tls=skip-verify: verified on MySQL 8 (tls=true verifies the certificate
        # and fails against a self-signed one). mssql encrypt=true: not verified against a live server yet.
        if FAMILY[kind] == "postgres":
            out["queryParams"] = {"sslmode": "require"}
        elif FAMILY[kind] == "mysql":
            out["queryParams"] = {"tls": "skip-verify"}
        else:
            out["encrypt"] = "true"
    return out


def render(connectors: list[dict]) -> str:
    """tools.yaml for the connectors (each dict = a Firestore doc plus its `id`). '' when no rule grants anything."""
    used, envs = _plan(connectors)
    docs: list[dict] = []
    for c, sid, qids, views in used:
        fam = FAMILY[c["kind"]]
        docs.append(_source(c, sid, (envs.get((c["id"], sid)) or (None,))[0]))
        qs = {q["id"]: q for q in c.get("queries") or []}
        for qid in qids:
            q = qs[qid]
            docs.append({"kind": "tool", "name": query_tool(c["id"], sid, qid), "type": f"{fam}-sql", "source": source_name(c["id"], sid),
                         "description": q.get("description") or q["name"], "statement": q["statement"],
                         "parameters": [{"name": p["name"], "type": p.get("type", "string"), "description": p.get("description") or p["name"],
                                         "required": bool(p.get("required", True))} for p in q.get("parameters") or []]})
        if views:
            docs.append({"kind": "tool", "name": sql_tool(c["id"], sid), "type": f"{fam}-execute-sql", "source": source_name(c["id"], sid),
                         "description": f"Run one read-only SELECT on {c['name']}. The platform checks the SQL before it is sent."})
    if not docs:
        return ""
    return "# Generated by the Medisense platform from the admin 資料庫連接器 page. Do not edit: changes are overwritten on the next apply.\n" + \
        yaml.safe_dump_all(docs, sort_keys=False, allow_unicode=True, width=10000)


def problems(connectors: list[dict]) -> list[str]:
    """Why this set cannot be deployed (empty = fine)."""
    out = []
    used, envs = _plan(connectors)
    if not used:
        out.append("沒有任何規則開放查詢或檢視表：沒有可套用的內容")
    for c, sid, qids, _ in used:
        if c["kind"] != "bigquery" and (c["id"], sid) not in envs:
            out.append(f"「{c['name']}」的帳號 {sid} 尚未設定密碼")
    return out
