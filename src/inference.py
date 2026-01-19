import json
import numpy as np
import pandas as pd
import joblib

from .audio_features import load_audio_safe, extract_audio_features

class GrammarScorer:
    def __init__(self, model_path: str, feature_cols_path: str):
        self.model = joblib.load(model_path)
        with open(feature_cols_path, "r") as f:
            self.feature_cols = json.load(f)

    def predict_file(self, audio_path: str) -> dict:
        audio, sr = load_audio_safe(audio_path)
        if audio is None or sr is None:
            return {"ok": False, "error": "Audio could not be loaded (corrupt/unsupported format)."}

        feats = extract_audio_features(audio, sr)

        # Build a single-row dataframe with correct column order
        row = {col: feats.get(col, np.nan) for col in self.feature_cols}
        X = pd.DataFrame([row], columns=self.feature_cols)

        # Median-impute within the row if any NaNs (simple safe approach)
        # For single row, fill NaNs with 0 as fallback (or keep a global median file later)
        X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0)

        pred = float(self.model.predict(X)[0])

        # Clamp to competition range 0..5
        pred = max(0.0, min(5.0, pred))

        return {
            "ok": True,
            "score": pred
        }
