"""Browse everything the Open Connector gateway supports (about 1,700 services), so builders and admins can see what could be
connected next. Read-only: enabling a service for users is a separate admin step (a per-user connector type, see
engine/connectors.py); services without a first-class type here are listed as "not enabled yet"."""
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore

from .. import db
from ..auth import User, require_builder
from ..engine import connectors as eng
from ..engine import open_connector as oc

router = APIRouter(prefix="/api/gateway-catalog", tags=["gateway-catalog"], dependencies=[Depends(require_builder)])


def _cat_ids(cats) -> list[str]:
    """Categories arrive as {id, displayName} objects in the list but as plain strings in a provider's detail."""
    return [c["id"] if isinstance(c, dict) else str(c) for c in cats or []]


def _enabled() -> dict[str, str]:
    """gateway service -> our connector type id, for types that are wired to a gateway service."""
    return {v["oc_service"]: k for k, v in eng.TYPES.items() if v.get("oc_service")}


def _enabled_connectors() -> dict[str, str]:
    """gateway service -> id of the generic connector an admin enabled for it (type 'gateway')."""
    q = db.client().collection("connectors").where(filter=firestore.FieldFilter("type", "==", "gateway")).stream()
    return {(d.to_dict() or {}).get("config", {}).get("service", ""): d.id for d in q}


def _gateway_down(exc: oc.OpenConnectorError) -> HTTPException:
    return HTTPException(503 if exc.code == "not_configured" else 502,
                         "尚未設定連接器閘道" if exc.code == "not_configured" else f"連接器閘道錯誤：{exc}")


def _item(p: dict, enabled: dict[str, str], generic: dict[str, str] | None = None) -> dict:
    generic = generic or {}
    return {"connector_id": generic.get(p["service"]), "service": p["service"], "name": p.get("displayName") or p["service"], "homepage": p.get("homepageUrl") or "",
            "icon_url": p.get("iconUrl") or "", "categories": _cat_ids(p.get("categories")),
            "auth_types": p.get("authTypes") or [], "enabled_type": enabled.get(p["service"]) or ("gateway" if p["service"] in generic else None)}


@router.get("")
def browse(q: str = "", category: str = "", auth: str = "", enabled_only: bool = False, services: str = "",
           offset: int = Query(0, ge=0), limit: int = Query(48, ge=1, le=200), user: User = Depends(require_builder)):
    try:
        all_items = oc.providers()
    except oc.OpenConnectorError as exc:
        raise _gateway_down(exc) from exc
    enabled, generic = _enabled(), _enabled_connectors()
    items = [_item(p, enabled, generic) for p in all_items]
    cats = Counter(c for i in items for c in i["categories"])
    auths = Counter(a for i in items for a in i["auth_types"])
    needle = q.strip().lower()
    only = {s.strip() for s in services.split(",") if s.strip()}
    rows = [i for i in items
            if (not only or i["service"] in only)
            and (not needle or needle in i["service"].lower() or needle in i["name"].lower() or any(needle in c.lower() for c in i["categories"]))
            and (not category or category in i["categories"]) and (not auth or auth in i["auth_types"])
            and (not enabled_only or i["enabled_type"])]
    rows.sort(key=lambda i: (not i["enabled_type"], i["name"].casefold()))
    return {"total": len(rows), "gateway_total": len(items), "offset": offset, "limit": limit, "items": rows[offset:offset + limit],
            "facets": {"categories": [{"id": k, "count": v} for k, v in cats.most_common()],
                       "auth": [{"id": k, "count": v} for k, v in auths.most_common()]},
            "enabled": sorted({*enabled, *generic})}


@router.get("/{service}")
def detail(service: str, user: User = Depends(require_builder)):
    try:
        known = {p["service"] for p in oc.providers()}
        if service not in known:
            raise HTTPException(404, "unknown service")
        d = oc.provider_detail(service)
    except oc.OpenConnectorError as exc:
        raise _gateway_down(exc) from exc
    ex = d.get("execution") or {}
    generic = _enabled_connectors()
    actions = [{"id": a.get("id", ""), "name": a.get("name", ""), "description": a.get("description", ""),
                "operation": a.get("operationType", "read")} for a in d.get("actions") or []]
    return {"service": service, "name": d.get("displayName") or service, "homepage": d.get("homepageUrl") or "",
            "categories": _cat_ids(d.get("categories")), "auth_types": d.get("authTypes") or [],
            "action_count": ex.get("actionCount", len(actions)), "executable_count": ex.get("locallyExecutableActionCount", len(actions)),
            "trigger_count": len(d.get("triggers") or []), "actions": actions,
            "enabled_type": _enabled().get(service) or ("gateway" if service in generic else None), "connector_id": generic.get(service)}
