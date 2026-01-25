import os
from openai import OpenAI

def transcribe_api(audio_path: str, model: str = "gpt-4o-mini-transcribe") -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    client = OpenAI(api_key=api_key)

    with open(audio_path, "rb") as f:
        # Audio Transcriptions endpoint
        out = client.audio.transcriptions.create(model=model, file=f)
    return (out.text or "").strip()
