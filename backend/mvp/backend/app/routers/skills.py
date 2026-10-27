"""Skills (skills/{id}): reusable instruction blocks an agent can attach (AgentIn.skill_ids); the flow
interpreter prepends enabled, viewable skills to LLM system prompts. Any signed-in user lists/reads the
skills shared with them; builders create; owner / edit-sharees update; owner / admin delete and share."""
from fastapi import APIRouter, Depends, HTTPException

from .. import db, sharing
from ..auth import User, current_user, require_builder
from ..schemas import EnabledPatch, Share, SkillIn, SkillOut

router = APIRouter(prefix="/api/skills", tags=["skills"])


def _col():
    return db.client().collection("skills")


def _out(doc, user: User, groups: set[str] | None = None) -> SkillOut:
    d = doc.to_dict() or {}
    return SkillOut(id=doc.id, my_role=sharing.my_role(user, d, groups), **{k: v for k, v in d.items() if k != "id"})


def _load(skill_id: str):
    snap = _col().document(skill_id).get()
    if not snap.exists:
        raise HTTPException(404, "skill not found")
    return snap


def _load_viewable(skill_id: str, user: User):
    snap = _load(skill_id)
    if not sharing.can_view(user, snap.to_dict() or {}):
        raise HTTPException(403, "skill is not shared with you")
    return snap


def _load_editable(skill_id: str, user: User):
    snap = _load(skill_id)
    if not sharing.can_edit(user, snap.to_dict() or {}):
        raise HTTPException(403, "you cannot edit this skill")
    return snap


@router.get("", response_model=list[SkillOut])
def list_skills(user: User = Depends(current_user)):
    """Skills the caller owns or that are shared with them (admins: all), newest first."""
    groups = sharing.group_ids_of(user.email)
    rows = [_out(d, user, groups) for d in sharing.visible_docs("skills", user).values()]
    return sorted(rows, key=lambda s: str(s.updated_at or ""), reverse=True)


@router.post("", response_model=SkillOut, status_code=201)
def create_skill(body: SkillIn, user: User = Depends(require_builder)):
    ref = _col().document()
    data = {**body.model_dump(), **sharing.share_fields(Share()), "owner_uid": user.uid, "owner_email": user.email,
            "created_at": db.now(), "updated_at": db.now()}
    ref.set(data)
    db.audit(user.uid, "skill.create", user.email, skill_id=ref.id, name=body.name)
    return _out(ref.get(), user)


@router.get("/{skill_id}", response_model=SkillOut)
def get_skill(skill_id: str, user: User = Depends(current_user)):
    return _out(_load_viewable(skill_id, user), user)


@router.put("/{skill_id}", response_model=SkillOut)
def update_skill(skill_id: str, body: SkillIn, user: User = Depends(require_builder)):
    snap = _load_editable(skill_id, user)
    snap.reference.update({**body.model_dump(), "updated_at": db.now()})
    db.audit(user.uid, "skill.update", user.email, skill_id=skill_id, name=body.name)
    return _out(snap.reference.get(), user)


@router.patch("/{skill_id}/enabled", response_model=SkillOut)
def set_enabled(skill_id: str, body: EnabledPatch, user: User = Depends(require_builder)):
    snap = _load_editable(skill_id, user)
    snap.reference.update({"enabled": body.enabled, "updated_at": db.now()})
    db.audit(user.uid, "skill.enable" if body.enabled else "skill.disable", user.email, skill_id=skill_id)
    return _out(snap.reference.get(), user)


@router.put("/{skill_id}/share", response_model=SkillOut)
def share_skill(skill_id: str, body: Share, user: User = Depends(require_builder)):
    snap = _load(skill_id)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can change sharing")
    snap.reference.update({**sharing.share_fields(sharing.validate_share(body)), "updated_at": db.now()})
    db.audit(user.uid, "skill.share", user.email, skill_id=skill_id, access=body.access, members=len(body.members))
    return _out(snap.reference.get(), user)


@router.delete("/{skill_id}", status_code=204)
def delete_skill(skill_id: str, user: User = Depends(require_builder)):
    snap = _load(skill_id)
    if not sharing.can_manage(user, snap.to_dict() or {}):
        raise HTTPException(403, "only the owner or an admin can delete this skill")
    snap.reference.delete()
    db.audit(user.uid, "skill.delete", user.email, skill_id=skill_id, name=(snap.to_dict() or {}).get("name", ""))
