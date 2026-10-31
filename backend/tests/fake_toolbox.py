"""A stand-in for MCP Toolbox: serves the tools of a rendered tools.yaml over MCP Streamable HTTP, backed by SQLite.
It enforces what the real one would: tools exist only if the YAML defines them, parameters are bound (never spliced)."""
import json
import re
import sqlite3
import threading
import time

import uvicorn
import yaml
from fastapi import FastAPI, Request


def make_app(tools_yaml: str, db: sqlite3.Connection, log: list) -> FastAPI:
    docs = [d for d in yaml.safe_load_all(tools_yaml) if d]
    tools = {d["name"]: d for d in docs if d["kind"] == "tool"}
    app = FastAPI()

    def run(sql: str, params: list) -> str:
        cur = db.execute(sql, params)
        cols = [c[0] for c in cur.description or []]
        return [json.dumps(dict(zip(cols, r)), ensure_ascii=False) for r in cur.fetchall()]

    @app.post("/mcp")
    async def mcp(req: Request):
        msg = await req.json()
        if msg.get("method") == "initialize":
            return {"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "fake-toolbox"}}}
        if "id" not in msg:
            return {}
        p = msg["params"]
        t = tools.get(p["name"])
        if not t:
            return {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32602, "message": f"tool {p['name']} not found"}}
        args = p.get("arguments") or {}
        log.append((p["name"], args))
        try:
            if t["type"].endswith("-execute-sql"):
                rows = run(args["sql"], [])
            else:
                order = [x["name"] for x in t.get("parameters") or []]
                sql = re.sub(r"\$\d+", "?", t["statement"])
                rows = run(sql, [args.get(n) for n in order])
        except Exception as e:  # noqa: BLE001
            return {"jsonrpc": "2.0", "id": msg["id"], "result": {"isError": True, "content": [{"type": "text", "text": str(e)}]}}
        return {"jsonrpc": "2.0", "id": msg["id"], "result": {"content": [{"type": "text", "text": r} for r in rows]}}

    return app


class Server:
    def __init__(self, app, port):
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self):
        self.thread.start()
        while not self.server.started:
            time.sleep(0.02)
        return self

    def __exit__(self, *a):
        self.server.should_exit = True
        self.thread.join(5)
