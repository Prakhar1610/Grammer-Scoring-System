import os
import subprocess
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename

from src.inference import GrammarScorer

# allow browser recordings too (.webm is common)
ALLOWED_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"}

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "app", "uploads")
MODEL_PATH = os.path.join(BASE_DIR, "models", "ridge_model.pkl")
COLS_PATH = os.path.join(BASE_DIR, "models", "feature_cols.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)

scorer = GrammarScorer(MODEL_PATH, COLS_PATH)

# tell flask where templates/static are (safe even if you run as module)
app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "app", "templates"),
    static_folder=os.path.join(BASE_DIR, "app", "static")
)

FFMPEG_PATH = r"D:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe"   # <-- change if your location differs

def convert_to_wav(input_path: str, output_path: str):
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", input_path,
        "-ac", "1",
        "-ar", "16000",
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# serve frontend page
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
    if f.filename == "":
        return jsonify({"ok": False, "error": "Empty filename."}), 400

    filename = secure_filename(f.filename)
    _, ext = os.path.splitext(filename.lower())
    if ext not in ALLOWED_EXT:
        return jsonify({"ok": False, "error": f"Unsupported file type {ext}. Use .wav ideally."}), 400

    save_path = os.path.join(UPLOAD_DIR, filename)
    f.save(save_path)

    # ✅ Convert to wav if not already wav
    wav_path = save_path
    if ext != ".wav":
        wav_path = os.path.splitext(save_path)[0] + ".wav"
        convert_to_wav(save_path, wav_path)

        # If conversion failed (wav not created or empty)
        if (not os.path.exists(wav_path)) or (os.path.getsize(wav_path) == 0):
            # cleanup
            try:
                os.remove(save_path)
            except Exception:
                pass
            return jsonify({"ok": False, "error": "FFmpeg conversion failed. Check ffmpeg in PATH."}), 400

    result = scorer.predict_file(wav_path)

    # Optional: delete after inference
    try:
        if os.path.exists(save_path):
            os.remove(save_path)
        if wav_path != save_path and os.path.exists(wav_path):
            os.remove(wav_path)
    except Exception:
        pass

    status = 200 if result.get("ok") else 400
    return jsonify(result), status

if __name__ == "__main__":
    app.run(debug=True, port=5000)
