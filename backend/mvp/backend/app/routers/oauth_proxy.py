"""Public OAuth redirect target. Google sends the browser here (no Firebase token on a redirect), and we relay the one callback
path to the internal Open Connector gateway, which validates `state` against the authorization it issued.

The gateway's public origin is `<hosting origin>/api/oc` (OOMOL_CONNECT_ORIGIN), so the redirect URI registered in Google is
`<hosting origin>/api/oc/oauth/callback`. Only that path is relayed; nothing else of the gateway is reachable from outside."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from ..engine import open_connector as oc

router = APIRouter(tags=["oauth"])


@router.get("/api/oc/oauth/callback", include_in_schema=False)
def oauth_callback(request: Request):
    if not oc.configured():
        raise HTTPException(503, "Open Connector is not configured")
    if len(request.url.query) > 4096:
        raise HTTPException(414, "query too long")
    try:
        status, ctype, body = oc.forward_callback(request.url.path, request.url.query)
    except Exception as exc:  # noqa: BLE001 - never leak gateway internals to a browser redirect
        raise HTTPException(502, "authorization callback failed") from exc
    return Response(content=body, status_code=status, media_type=ctype.split(";")[0],
                    headers={"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"})
