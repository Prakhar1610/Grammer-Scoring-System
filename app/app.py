import os
import subprocess
import uuid
import pyttsx3

from flask import Flask, request, jsonify, render_template, send_file
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

from src.inference import GrammarScorer
from src.asr.router import transcribe

from src.nlp.grammar import correct_with_languagetool
from src.nlp.punctuate import ensure_sentence_end


# ----------------------------
# Paths / Config
# ----------------------------

# Project root (…/Grammer-scoring-system)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load .env from project root (important)
load_dotenv(os.path.join(BASE_DIR, ".env"))

# allow browser recordings too (.webm is common)
ALLOWED_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"}

UPLOAD_DIR = os.path.join(BASE_DIR, "app", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# TTS output folder
TTS_DIR = os.path.join(BASE_DIR, "app", "tts")
os.makedirs(TTS_DIR, exist_ok=True)

MODEL_PATH = os.path.join(BASE_DIR, "models", "ridge_model.pkl")
COLS_PATH  = os.path.join(BASE_DIR, "models", "feature_cols.json")

scorer = GrammarScorer(MODEL_PATH, COLS_PATH)

# tell flask where templates/static are
app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "app", "templates"),
    static_folder=os.path.join(BASE_DIR, "app", "static")
)

# Prefer ffmpeg in PATH; fallback to hard-coded path if you want
FFMPEG_PATH = os.getenv("FFMPEG_PATH", r"D:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe")


def ffmpeg_exists() -> bool:
    """True if ffmpeg command is runnable."""
    if FFMPEG_PATH.lower() == "ffmpeg":
        return True
    return os.path.exists(FFMPEG_PATH)


def convert_to_wav(input_path: str, output_path: str):
    """
    Convert any supported audio to 16kHz mono wav.
    Raises RuntimeError on failure.
    """
    if not ffmpeg_exists():
        raise RuntimeError(
            f"FFmpeg not found at: {FFMPEG_PATH}. "
            "Either add ffmpeg to PATH and set FFMPEG_PATH=ffmpeg in .env, "
            "or update FFMPEG_PATH in app.py."
        )

    cmd = [
        FFMPEG_PATH if FFMPEG_PATH.lower() != "ffmpeg" else "ffmpeg",
        "-y",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        output_path
    ]

    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg conversion failed: {proc.stderr[:400]}")

    if (not os.path.exists(output_path)) or (os.path.getsize(output_path) == 0):
        raise RuntimeError("FFmpeg conversion produced empty output wav.")


# ----------------------------
# Routes
# ----------------------------

@app.get("/")
def home():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"ok": True, "status": "healthy"})


@app.post("/predict")
def predict():
    if "audio" not in request.files:
        return jsonify({"ok": False, "error": "No file part 'audio' found."}), 400

    f = request.files["audio"]
    if not f or f.filename.strip() == "":
        return jsonify({"ok": False, "error": "Empty filename."}), 400

    filename = secure_filename(f.filename)
    _, ext = os.path.splitext(filename.lower())

    if ext not in ALLOWED_EXT:
        return jsonify({"ok": False, "error": f"Unsupported file type {ext}. Use .wav ideally."}), 400

    save_path = os.path.join(UPLOAD_DIR, filename)
    f.save(save_path)

    wav_path = save_path
    try:
        # Always convert to 16kHz mono WAV (Vosk requires this)
        wav_path = os.path.splitext(save_path)[0] + "_16k.wav"
        convert_to_wav(save_path, wav_path)

        # 1) Score
        result = scorer.predict_file(wav_path)

        # 2) ASR
        asr = transcribe(wav_path)
        result["transcript"] = asr.get("text", "") or ""
        result["asr_mode"] = asr.get("mode_used") or "none"

        # Small cleanup
        result["transcript"] = result["transcript"].replace(" i ", " I ")

        # 3) Grammar correction
        raw = result["transcript"]
        formatted = ensure_sentence_end(raw)  # light formatting
        gc = correct_with_languagetool(formatted, language="en-US")

        result["corrected_text"] = gc["corrected"]
        result["grammar_matches"] = gc["matches"]
        result["grammar_mode"] = gc["mode_used"]

        if not asr.get("ok", False):
            result["asr_error"] = asr.get("error") or "ASR failed"
        if "fallback_from" in asr:
            result["asr_fallback_from"] = asr["fallback_from"]

        status = 200 if result.get("ok") else 400
        return jsonify(result), status

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    finally:
        try:
            if os.path.exists(save_path):
                os.remove(save_path)
            if wav_path != save_path and os.path.exists(wav_path):
                os.remove(wav_path)
        except Exception:
            pass


# NEW: TTS route
@app.post("/tts")
def tts():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"ok": False, "error": "No text provided"}), 400

    out_name = f"tts_{uuid.uuid4().hex}.wav"
    out_path = os.path.join(TTS_DIR, out_name)

    engine = pyttsx3.init()
    engine.setProperty("rate", 170)
    engine.save_to_file(text, out_path)
    engine.runAndWait()

    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return jsonify({"ok": False, "error": "TTS generation failed"}), 500

    return send_file(out_path, mimetype="audio/wav", as_attachment=False)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
