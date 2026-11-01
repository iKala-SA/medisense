"""Voice conversation: the reply read aloud by Cloud Text-to-Speech. Behind the same admin switch as the microphone (voice_input)."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import db
from ..auth import User, current_user
from ..engine import features as feat
from ..engine import tts

router = APIRouter(prefix="/api/tts", tags=["tts"])
log = logging.getLogger(__name__)


def _enabled() -> bool:
    snap = db.client().collection("config").document("features").get()
    return bool({**feat.DEFAULTS, **((snap.to_dict() if snap.exists else None) or {})}.get("voice_input"))


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = tts.DEFAULT_VOICE
    rate: float = 1.0


@router.get("/voices")
def voices(user: User = Depends(current_user)):
    return {"enabled": _enabled(), "default": tts.DEFAULT_VOICE, "voices": tts.VOICES}


@router.post("")
def speak(body: SpeakIn, user: User = Depends(current_user)):
    if not _enabled():
        raise HTTPException(403, "voice input is not enabled by an administrator")
    if not tts.voice_of(body.voice):
        raise HTTPException(422, "unknown voice")
    try:
        audio = tts.synthesize(body.text, body.voice, body.rate)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # noqa: BLE001 - quota / API errors: the browser falls back to its own voice
        log.warning("tts failed: %s", e)
        raise HTTPException(502, "text-to-speech is unavailable") from e
    db.audit(user.uid, "tts.speak", user.email, voice=body.voice, chars=min(len(body.text), tts.MAX_CHARS))
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
