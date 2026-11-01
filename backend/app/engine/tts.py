"""Cloud Text-to-Speech for the voice conversation (the reply is read aloud). The text is the already de-identified reply; only its
length is audited. Chirp 3 HD is the most natural (Mandarin voices; ~1.3 s per sentence); Wavenet is Taiwan-accented and fast (~0.4 s).
Gemini TTS was measured at ~4 s per sentence and is left out: too slow for a conversation."""
from functools import lru_cache

MAX_CHARS = 500
_CHIRP_F = ["Aoede", "Kore", "Leda", "Zephyr", "Despina", "Sulafat", "Vindemiatrix"]
_CHIRP_M = ["Puck", "Charon", "Fenrir", "Orus", "Algenib"]
VOICES = (
    [{"id": f"cmn-CN-Chirp3-HD-{n}", "name": n, "gender": "female", "group": "chirp", "lang": "cmn-CN"} for n in _CHIRP_F]
    + [{"id": f"cmn-CN-Chirp3-HD-{n}", "name": n, "gender": "male", "group": "chirp", "lang": "cmn-CN"} for n in _CHIRP_M]
    + [{"id": "cmn-TW-Wavenet-A", "name": "台灣華語 A", "gender": "female", "group": "wavenet", "lang": "cmn-TW"},
       {"id": "cmn-TW-Wavenet-B", "name": "台灣華語 B", "gender": "male", "group": "wavenet", "lang": "cmn-TW"},
       {"id": "cmn-TW-Wavenet-C", "name": "台灣華語 C", "gender": "male", "group": "wavenet", "lang": "cmn-TW"}]
)
DEFAULT_VOICE = "cmn-CN-Chirp3-HD-Aoede"
_BY_ID = {v["id"]: v for v in VOICES}


def voice_of(voice_id: str) -> dict | None:
    return _BY_ID.get(voice_id)


@lru_cache
def _client():
    from google.cloud import texttospeech
    return texttospeech.TextToSpeechClient()


def synthesize(text: str, voice_id: str, rate: float = 1.0) -> bytes:
    """MP3 bytes. Raises ValueError for an unknown voice / empty text; Google errors propagate."""
    from google.cloud import texttospeech as t
    v = voice_of(voice_id)
    text = (text or "").strip()[:MAX_CHARS]
    if not v or not text:
        raise ValueError("unknown voice or empty text")
    r = _client().synthesize_speech(
        input=t.SynthesisInput(text=text),
        voice=t.VoiceSelectionParams(language_code=v["lang"], name=v["id"]),
        audio_config=t.AudioConfig(audio_encoding=t.AudioEncoding.MP3, speaking_rate=max(0.8, min(1.3, float(rate)))))
    return r.audio_content
