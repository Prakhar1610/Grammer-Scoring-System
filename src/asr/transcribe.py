# src/asr/transcribe.py
import os
from typing import Dict, Optional

def transcribe_auto(audio_path: str) -> Dict:
    """
    Returns:
      {
        "ok": bool,
        "transcript": str,
        "asr_mode": "local" | "openai" | "none",
        "asr_error": str | None
      }
    """
    # 1) Try local ASR if available
    local = _try_local_faster_whisper(audio_path)
    if local["ok"]:
        local["asr_mode"] = "local"
        return local

    # 2) Fallback to OpenAI if key exists
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        cloud = _try_openai_transcribe(audio_path, api_key=api_key)
        if cloud["ok"]:
            cloud["asr_mode"] = "openai"
            return cloud
        # if cloud fails too, return cloud error but preserve local error for debugging
        cloud["asr_error"] = f"Local failed: {local.get('asr_error')} | OpenAI failed: {cloud.get('asr_error')}"
        cloud["asr_mode"] = "none"
        return cloud

    # 3) No key and local failed
    return {
        "ok": False,
        "transcript": "",
        "asr_mode": "none",
        "asr_error": local.get("asr_error") or "No ASR available (no OPENAI_API_KEY and local ASR not working)."
    }


def _try_openai_transcribe(audio_path: str, api_key: str) -> Dict:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        # Audio transcriptions endpoint (speech→text). :contentReference[oaicite:1]{index=1}
        with open(audio_path, "rb") as f:
            out = client.audio.transcriptions.create(
                model="gpt-4o-mini-transcribe",
                file=f
            )
        text = (out.text or "").strip()
        return {"ok": True, "transcript": text, "asr_error": None}
    except Exception as e:
        return {"ok": False, "transcript": "", "asr_error": str(e)}


def _try_local_faster_whisper(audio_path: str) -> Dict:
    try:
        from faster_whisper import WhisperModel

        # small/base are fine for CPU demos
        model = WhisperModel("small", device="cpu", compute_type="int8")
        segments, info = model.transcribe(audio_path, beam_size=5)
        text = " ".join([seg.text.strip() for seg in segments]).strip()
        return {"ok": True, "transcript": text, "asr_error": None}
    except Exception as e:
        return {"ok": False, "transcript": "", "asr_error": str(e)}
