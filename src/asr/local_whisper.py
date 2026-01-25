import whisper

_model = None

def transcribe_local(audio_path: str, model_name: str = "tiny.en") -> str:
    global _model
    if _model is None:
        _model = whisper.load_model(model_name)

    result = _model.transcribe(audio_path)
    return (result.get("text") or "").strip()
