"""Who may use a database connector, and as which database role (docs/DB-CONNECTORS-DESIGN.md §3).

A connector has an ordered list of rules (group -> database login + queries + views). The caller's groups are looked up
and the FIRST matching rule wins; no match = no access. Admins get no shortcut: data access follows the rules, like
everyone else (they manage connectors, they do not read the data by virtue of the role). The model never chooses a rule
and never supplies the caller's attributes: they come from the verified session."""
from __future__ import annotations

from typing import Any

from .. import sharing


def match_rule(connector: dict, email: str, groups: set[str] | None = None) -> tuple[int, dict] | None:
    """-> (index, rule) of the first rule whose group lists `email`, else None."""
    rules = connector.get("rules") or []
    if not rules:
        return None
    mine = groups if groups is not None else sharing.group_ids_of(email)
    for i, r in enumerate(rules):
        if r.get("group_id") in mine:
            return i, r
    return None


def grant(connector: dict, email: str, groups: set[str] | None = None) -> dict | None:
    """What the caller may do on this connector, or None. Secrets and statements stay server-side."""
    hit = match_rule(connector, email, groups)
    if not hit:
        return None
    i, r = hit
    src = next((s for s in connector.get("sources") or [] if s.get("id") == r.get("source_id")), None)
    qs = {q["id"]: q for q in connector.get("queries") or []}
    vs = {v["id"]: v for v in connector.get("views") or []}
    return {"rule": i, "group_id": r["group_id"], "source_id": r.get("source_id", ""), "source_label": (src or {}).get("label", ""),
            "queries": [qs[x] for x in r.get("queries") or [] if x in qs], "views": [vs[x] for x in r.get("views") or [] if x in vs]}


def public_grant(g: dict) -> dict[str, Any]:
    """The part of a grant the model / UI may see: query names and parameters (not SQL), views with their non-sensitive columns."""
    return {"rule": g["rule"], "source_label": g["source_label"],
            "queries": [{"id": q["id"], "name": q["name"], "description": q.get("description", ""), "parameters": q.get("parameters", [])} for q in g["queries"]],
            "views": [{"id": v["id"], "name": v["name"], "description": v.get("description", ""),
                       "columns": [c for c in v["columns"] if not c.get("sensitive")]} for v in g["views"]]}
