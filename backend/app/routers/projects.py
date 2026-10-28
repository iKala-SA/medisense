"""Projects: a folder of the caller's own conversations (ChatGPT-style). Strictly per user (`uid`). Deleting a project
never deletes chats: they go back to the normal recent list."""
from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore

from .. import db
from ..auth import User, current_user
from ..schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])
MAX_PROJECTS = 50


def _col():
    return db.client().collection("projects")


def _out(doc_id: str, d: dict) -> ProjectOut:
    return ProjectOut(id=doc_id, name=d.get("name", ""), created_at=d.get("created_at"), updated_at=d.get("updated_at"))


def own_project(project_id: str, user: User):
    snap = _col().document(project_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("uid") != user.uid:  # 404 for both: other people's ids are not probeable
        raise HTTPException(404, "project not found")
    return snap


def _name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise HTTPException(422, "name is empty")
    return name


@router.get("", response_model=list[ProjectOut])
def list_projects(user: User = Depends(current_user)):
    docs = _col().where(filter=firestore.FieldFilter("uid", "==", user.uid)).stream()
    rows = [(d.id, d.to_dict() or {}) for d in docs]
    rows.sort(key=lambda r: str(r[1].get("created_at") or ""))
    return [_out(i, d) for i, d in rows]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, user: User = Depends(current_user)):
    if len(list(_col().where(filter=firestore.FieldFilter("uid", "==", user.uid)).limit(MAX_PROJECTS).stream())) >= MAX_PROJECTS:
        raise HTTPException(409, f"at most {MAX_PROJECTS} projects")
    d = {"uid": user.uid, "name": _name(body.name), "created_at": db.now(), "updated_at": db.now()}
    ref = _col().document()
    ref.set(d)
    db.audit(user.uid, "project.create", user.email, project_id=ref.id)
    return _out(ref.id, d)


@router.patch("/{project_id}", response_model=ProjectOut)
def rename_project(project_id: str, body: ProjectIn, user: User = Depends(current_user)):
    snap = own_project(project_id, user)
    upd = {"name": _name(body.name), "updated_at": db.now()}
    snap.reference.update(upd)
    db.audit(user.uid, "project.update", user.email, project_id=project_id)
    return _out(snap.id, {**(snap.to_dict() or {}), **upd})


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, user: User = Depends(current_user)):
    snap = own_project(project_id, user)
    q = (db.client().collection("sessions").where(filter=firestore.FieldFilter("uid", "==", user.uid))
         .where(filter=firestore.FieldFilter("project_id", "==", project_id)))
    for s in q.stream():
        s.reference.update({"project_id": ""})
    snap.reference.delete()
    db.audit(user.uid, "project.delete", user.email, project_id=project_id)
