import os
import subprocess
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename

from dotenv import load_dotenv

from src.inference import GrammarScorer
from src.asr.router import transcribe

# from src.grammar.correct import correct_grammar

from src.grammar_correction.languagetool_client import correct_with_languagetool


from src.nlp.punctuate import ensure_sentence_end
from src.nlp.grammar import correct_with_languagetool


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
MODEL_PATH = os.path.join(BASE_DIR, "models", "ridge_model.pkl")
COLS_PATH  = os.path.join(BASE_DIR, "models", "feature_cols.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)

scorer = GrammarScorer(MODEL_PATH, COLS_PATH)

# tell flask where templates/static are
app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "app", "templates"),
    static_folder=os.path.join(BASE_DIR, "app", "static")
)

# Prefer ffmpeg in PATH; fallback to hard-coded path if you want
# If you already added ffmpeg to PATH, you can set this to "ffmpeg"
FFMPEG_PATH = os.getenv("FFMPEG_PATH", r"D:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe")


def ffmpeg_exists() -> bool:
    """True if ffmpeg command is runnable."""
    # If user set FFMPEG_PATH=ffmpeg, this should work too
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

    # capture stderr for debugging
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
        # Convert to wav if not already wav
        # if ext != ".wav":
        #     wav_path = os.path.splitext(save_path)[0] + ".wav"
        #     convert_to_wav(save_path, wav_path)

        # Always convert to 16kHz mono WAV (Vosk requires this)
        wav_path = os.path.splitext(save_path)[0] + "_16k.wav"
        convert_to_wav(save_path, wav_path)


        # 1) Score
        result = scorer.predict_file(wav_path)

        # 2) ASR
        asr = transcribe(wav_path)
        result["transcript"] = asr.get("text", "") or ""
        result["asr_mode"] = asr.get("mode_used") or "none"


        result["transcript"] = result["transcript"].replace(" i ", " I ")


        # 3) Grammar correction (punctuate -> LanguageTool)
        raw = result["transcript"]

        # Step 1: Light punctuation + capitalization
        formatted = ensure_sentence_end(raw)

        # Step 2: Grammar correction using LanguageTool
        gc = correct_with_languagetool(formatted, language="en-US")

        result["corrected_text"] = gc["corrected"]
        result["grammar_matches"] = gc["matches"] 
        result["grammar_mode"] = gc["mode_used"]

        
        # # Running LanguageTool on punctuated text
        # gc = correct_with_languagetool(punct, language="en-US")

        # # Store results
        # result["corrected_text"] = gc["corrected"]
        # result["grammar_matches"] = gc["matches"]
        # result["grammar_mode"] = gc["mode_used"]

        #corrected, matches = correct_with_languagetool(result["transcript"], language="en-US")

        # Basic formatting: capitalization + punctuation
        #corrected = basic_punctuate(corrected)

        # result["corrected_text"] = corrected
        # result["grammar_matches"] = matches
        # result["grammar_mode"] = "languagetool"
        # gc = correct_grammar(result["transcript"])
        # result["corrected_text"] = gc.get("corrected", "")
        # result["grammar_mode"] = gc.get("mode_used", "none")
        # result["grammar_matches"] = gc.get("matches", [])

        # if not gc.get("ok", False):
        #     result["grammar_error"] = gc.get("error")

        if not asr.get("ok", False):
            result["asr_error"] = asr.get("error") or "ASR failed"
        if "fallback_from" in asr:
            result["asr_fallback_from"] = asr["fallback_from"]

        status = 200 if result.get("ok") else 400
        return jsonify(result), status

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    finally:
        # cleanup uploaded + converted file
        try:
            if os.path.exists(save_path):
                os.remove(save_path)
            if wav_path != save_path and os.path.exists(wav_path):
                os.remove(wav_path)
        except Exception:
            pass


if __name__ == "__main__":
    app.run(debug=True, port=5000)
