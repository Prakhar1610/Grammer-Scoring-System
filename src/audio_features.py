import numpy as np
import soundfile as sf
import librosa

def load_audio_safe(path: str):
    # Strict loader first
    try:
        audio, sr = sf.read(path)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return audio.astype(np.float32), sr
    except Exception:
        pass

    # Fallback loader
    try:
        audio, sr = librosa.load(path, sr=None, mono=True)
        return audio.astype(np.float32), sr
    except Exception:
        return None, None

def extract_audio_features(audio: np.ndarray, sr: int) -> dict:
    # MFCCs (13)
    mfccs = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=13)
    mfccs_mean = np.mean(mfccs, axis=1)

    # Chroma (12)
    chroma = librosa.feature.chroma_stft(y=audio, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)

    # Spectral contrast (7-ish; librosa returns n_bands+1)
    contrast = librosa.feature.spectral_contrast(y=audio, sr=sr, fmin=200)
    contrast_mean = np.mean(contrast, axis=1)

    # ZCR, RMSE
    zcr_mean = float(np.mean(librosa.feature.zero_crossing_rate(y=audio)))
    rmse = librosa.feature.rms(y=audio)
    rmse_mean = float(np.mean(rmse)) if np.isfinite(np.mean(rmse)) else np.nan

    feats = {}

    for i, v in enumerate(mfccs_mean):
        feats[f"mfcc_{i}"] = float(v)

    for i, v in enumerate(chroma_mean):
        feats[f"chroma_{i}"] = float(v)

    for i, v in enumerate(contrast_mean):
        feats[f"contrast_{i}"] = float(v)

    feats["zcr"] = zcr_mean
    feats["rmse"] = rmse_mean

    return feats
