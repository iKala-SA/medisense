"""Sharing ACL shared by agents, skills, schedules and spaces.

A document carries `owner_uid` and `share` {access, role, members[]} (schemas.Share):
  * the owner and any admin can always view and edit;
  * access == "account": every signed-in user gets `role` (use = view/run, edit = view/run/edit);
  * members are matched by e-mail (type user) or by group membership (type group; groups/{id}.member_emails).
"use" means view/run; "edit" implies "use". Deleting and changing the share list stay owner/admin only
(`can_manage`). Callers add their own extra rules (e.g. agents: published == hospital-wide).

`share_keys` is a denormalised list ("u:<email>", "g:<groupId>") written next to `share`, so a
list endpoint can find shared documents with one array-contains-any query instead of scanning.
"""
from typing import Any

from google.cloud import firestore

from . import db
from .schemas import Share

ROLE_RANK = {"use": 1, "edit": 2}


def _share(doc: dict) -> dict:
    s = doc.get("share")
    return s if isinstance(s, dict) else {}


def is_owner(user: Any, doc: dict) -> bool:
    return bool(doc.get("owner_uid")) and doc.get("owner_uid") == user.uid


def group_ids_of(email: str) -> set[str]:
    """Ids of the groups that list this e-mail."""
    q = db.client().collection("groups").where(filter=firestore.FieldFilter("member_emails", "array_contains", email.lower()))
    return {d.id for d in q.stream()}


def granted_role(user: Any, doc: dict, groups: set[str] | None = None) -> str | None:
    """Best role the share block grants this user: 'edit', 'use' or None. Ignores ownership/admin."""
    share = _share(doc)
    best = 0
    if share.get("access") == "account":
        best = ROLE_RANK.get(share.get("role", "use"), 1)
    members = share.get("members") or []
    email = user.email.lower()
    if any(m.get("type") == "group" for m in members) and groups is None:
        groups = group_ids_of(email)
    for m in members:
        hit = (m.get("type") == "user" and str(m.get("id", "")).lower() == email) or \
              (m.get("type") == "group" and m.get("id") in (groups or set()))
        if hit:
            best = max(best, ROLE_RANK.get(m.get("role", "use"), 1))
    return {2: "edit", 1: "use"}.get(best)


def can_view(user: Any, doc: dict, groups: set[str] | None = None) -> bool:
    return user.role == "admin" or is_owner(user, doc) or granted_role(user, doc, groups) is not None


def can_edit(user: Any, doc: dict, groups: set[str] | None = None) -> bool:
    return user.role == "admin" or is_owner(user, doc) or granted_role(user, doc, groups) == "edit"


def can_manage(user: Any, doc: dict) -> bool:
    """Delete / change sharing: owner or admin only."""
    return user.role == "admin" or is_owner(user, doc)


def my_role(user: Any, doc: dict, groups: set[str] | None = None) -> str:
    if is_owner(user, doc):
        return "owner"
    if user.role == "admin":
        return "admin"
    return granted_role(user, doc, groups) or "use"


def share_keys(share: Share | dict) -> list[str]:
    data = share.model_dump() if isinstance(share, Share) else share
    return sorted({f"{'u' if m['type'] == 'user' else 'g'}:{m['id']}" for m in data.get("members") or []})


def share_fields(share: Share) -> dict:
    return {"share": share.model_dump(), "share_keys": share_keys(share)}


def validate_share(share: Share) -> Share:
    """Reject group members that do not exist (user members are free-form e-mails)."""
    from fastapi import HTTPException

    for m in share.members:
        if m.type == "group" and not db.client().collection("groups").document(m.id).get().exists:
            raise HTTPException(422, f"group {m.id} not found")
    return share


def visible_docs(col: str, user: Any, admin_all: bool = True, extra_owner_field: str = "owner_uid") -> dict[str, Any]:
    """Snapshots in `col` the user may view through ownership or `share`, keyed by id. Admins get everything unless admin_all=False.
    Single-field queries only (no composite index)."""
    c = db.client().collection(col)
    if user.role == "admin" and admin_all:
        return {d.id: d for d in c.stream()}
    out: dict[str, Any] = {}
    for d in c.where(filter=firestore.FieldFilter(extra_owner_field, "==", user.uid)).stream():
        out[d.id] = d
    for d in c.where(filter=firestore.FieldFilter("share.access", "==", "account")).stream():
        out.setdefault(d.id, d)
    keys = [f"u:{user.email.lower()}", *(f"g:{g}" for g in group_ids_of(user.email))]
    for i in range(0, len(keys), 25):  # array-contains-any takes at most 30 values
        for d in c.where(filter=firestore.FieldFilter("share_keys", "array_contains_any", keys[i:i + 25])).stream():
            out.setdefault(d.id, d)
    return out
