import os, json, wave
from vosk import Model, KaldiRecognizer

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VOSK_MODEL_PATH = os.path.join(BASE_DIR, "models", "vosk", "vosk-model-en-in-0.5")

_model = None

def transcribe_vosk(wav_path: str) -> str:
    global _model

    if not os.path.exists(VOSK_MODEL_PATH):
        raise RuntimeError("Vosk model not found at " + VOSK_MODEL_PATH)

    if _model is None:
        _model = Model(VOSK_MODEL_PATH)

    wf = wave.open(wav_path, "rb")

    # Vosk requirements
    if wf.getnchannels() != 1:
        raise RuntimeError("Audio must be mono WAV")
    if wf.getsampwidth() != 2:
        raise RuntimeError("Audio must be 16-bit PCM WAV")
    if wf.getframerate() != 16000:
        raise RuntimeError("Audio must be 16kHz WAV")

    rec = KaldiRecognizer(_model, 16000)
    rec.SetWords(True)

    text_parts = []

    while True:
        data = wf.readframes(8000)
        if len(data) == 0:
            break

        if rec.AcceptWaveform(data):
            part = json.loads(rec.Result())
            if part.get("text"):
                text_parts.append(part["text"])

    final = json.loads(rec.FinalResult())
    if final.get("text"):
        text_parts.append(final["text"])

    wf.close()  # ✅ Improvement B: close file

    text = " ".join(text_parts).strip()
    text = text.replace(" i ", " I ")  # ✅ Improvement A: fix lowercase i

    return text
