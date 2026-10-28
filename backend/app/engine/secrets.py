"""Connector credentials live in Secret Manager; Firestore keeps only the secret name.

Naming: tcvgh-conn-<connectorId>-<field>. One secret per credential field, newest version wins.
The backend SA needs roles/secretmanager.admin (create/delete) + secretAccessor (infra/02-foundation.sh).
"""
from functools import lru_cache

from google.api_core.exceptions import AlreadyExists, NotFound
from google.cloud import secretmanager

from ..config import settings


@lru_cache
def _client() -> secretmanager.SecretManagerServiceClient:
    return secretmanager.SecretManagerServiceClient()


def _name(connector_id: str, field: str) -> str:
    return f"tcvgh-conn-{connector_id}-{field}"[:255]


def put(connector_id: str, field: str, value: str) -> str:
    """Create the secret if needed, add a version, return `projects/.../secrets/<name>`."""
    s = settings()
    parent = f"projects/{s.google_cloud_project}"
    sid = _name(connector_id, field)
    try:
        _client().create_secret(
            parent=parent, secret_id=sid,
            secret={"replication": {"user_managed": {"replicas": [{"location": s.region}]}},
                    "labels": {"app": "tcvgh-agent-platform", "connector": connector_id.lower()[:63]}},  # label values must be lowercase (Firestore ids are mixed case)
        )
    except AlreadyExists:
        pass
    name = f"{parent}/secrets/{sid}"
    _client().add_secret_version(parent=name, payload={"data": value.encode()})
    return name


def get(secret_name: str) -> str:
    resp = _client().access_secret_version(name=f"{secret_name}/versions/latest")
    return resp.payload.data.decode()


def delete(secret_name: str) -> None:
    try:
        _client().delete_secret(name=secret_name)
    except NotFound:
        pass
