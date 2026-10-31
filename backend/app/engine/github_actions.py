"""Minimal GitHub Actions client for the LiteLLM apply workflow (.github/workflows/litellm-apply.yml).

dispatch() starts the workflow; find_run() locates that run afterwards. The dispatch API returns no run id, so
the workflow's run-name embeds the registry version ("LiteLLM apply v<N>") and we match on it.
"""
import httpx

from ..config import settings

API = "https://api.github.com"
TIMEOUT = 15


class NotConfigured(RuntimeError):
    pass


def run_title(version: int) -> str:
    return f"LiteLLM apply v{version}"


def _client() -> httpx.Client:
    s = settings()
    if not (s.github_repo and s.github_dispatch_token):
        raise NotConfigured("GITHUB_REPO / GITHUB_DISPATCH_TOKEN not set on the backend")
    return httpx.Client(base_url=f"{API}/repos/{s.github_repo}", timeout=TIMEOUT,
                        headers={"Authorization": f"Bearer {s.github_dispatch_token}",
                                 "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})


def toolbox_run_title(version: int) -> str:
    return f"Toolbox apply v{version}"


def dispatch(version: int, requested_by: str, workflow: str | None = None) -> None:
    s = settings()
    with _client() as c:
        r = c.post(f"/actions/workflows/{workflow or s.litellm_apply_workflow}/dispatches",
                   json={"ref": s.github_ref, "inputs": {"version": str(version), "requested_by": requested_by}})
    r.raise_for_status()


def find_run(version: int, workflow: str | None = None, title: str | None = None) -> dict | None:
    """Newest workflow_dispatch run for this version: {status, conclusion, html_url} or None if not started yet."""
    s = settings()
    with _client() as c:
        r = c.get(f"/actions/workflows/{workflow or s.litellm_apply_workflow}/runs",
                  params={"event": "workflow_dispatch", "per_page": 20})
    r.raise_for_status()
    title = title or run_title(version)
    for run in r.json().get("workflow_runs", []):  # newest first
        if run.get("display_title") == title:
            return {"status": run.get("status"), "conclusion": run.get("conclusion"), "html_url": run.get("html_url")}
    return None
