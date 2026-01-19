import os
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

from src.inference import GrammarScorer

ALLOWED_EXT = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}  # wav recommended

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "app", "uploads")
MODEL_PATH = os.path.join(BASE_DIR, "models", "ridge_model.pkl")
COLS_PATH = os.path.join(BASE_DIR, "models", "feature_cols.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)

scorer = GrammarScorer(MODEL_PATH, COLS_PATH)

app = Flask(__name__)

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

    result = scorer.predict_file(save_path)

    # Optional: delete after inference
    try:
        os.remove(save_path)
    except Exception:
        pass

    status = 200 if result.get("ok") else 400
    return jsonify(result), status

if __name__ == "__main__":
    app.run(debug=True, port=5000)
