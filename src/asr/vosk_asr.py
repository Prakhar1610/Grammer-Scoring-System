import os
import json
import wave
from vosk import Model, KaldiRecognizer

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VOSK_MODEL_PATH = os.path.join(BASE_DIR, "models", "vosk", "vosk-model-small-en-us-0.15")

_model = None

def transcribe_vosk(wav_path: str) -> str:
    global _model

    if not os.path.exists(VOSK_MODEL_PATH):
        raise RuntimeError("Vosk model not found at " + VOSK_MODEL_PATH)

    if _model is None:
        _model = Model(VOSK_MODEL_PATH)

    wf = wave.open(wav_path, "rb")

    if wf.getnchannels() != 1:
        raise RuntimeError("Audio must be mono WAV")
    if wf.getsampwidth() != 2:
        raise RuntimeError("Audio must be 16-bit PCM WAV")
    if wf.getframerate() != 16000:
        raise RuntimeError("Audio must be 16kHz WAV")

    rec = KaldiRecognizer(_model, wf.getframerate())
    rec.SetWords(True)

    text_chunks = []

    while True:
        data = wf.readframes(4000)
        if len(data) == 0:
            break
        if rec.AcceptWaveform(data):
            part = json.loads(rec.Result())
            text_chunks.append(part.get("text", ""))

    final = json.loads(rec.FinalResult())
    text_chunks.append(final.get("text", ""))

    return " ".join(text_chunks).strip()
