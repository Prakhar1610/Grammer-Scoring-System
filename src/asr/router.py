from src.asr.vosk_asr import transcribe_vosk

def transcribe(wav_path: str) -> dict:
    """
    Offline ASR using Vosk.
    """
    try:
        text = transcribe_vosk(wav_path)
        return {
            "ok": True,
            "text": text,
            "mode_used": "vosk"
        }
    except Exception as e:
        return {
            "ok": False,
            "text": "",
            "mode_used": "vosk",
            "error": str(e)
        }



# import os
# from .local_whisper import transcribe_local
# from .openai_api import transcribe_api

# def transcribe(audio_path: str) -> dict:
#     """
#     Returns dict: { ok, mode_used, text, error? }
#     ASR_MODE: local | api | auto
#     """
#     mode = (os.getenv("ASR_MODE") or "auto").lower()
#     whisper_model = os.getenv("WHISPER_MODEL") or "tiny.en"
#     api_model = os.getenv("OPENAI_ASR_MODEL") or "gpt-4o-mini-transcribe"

#     if mode == "local":
#         try:
#             text = transcribe_local(audio_path, whisper_model)
#             return {"ok": True, "mode_used": "local", "text": text}
#         except Exception as e:
#             return {"ok": False, "mode_used": "local", "error": str(e), "text": ""}

#     if mode == "api":
#         try:
#             text = transcribe_api(audio_path, api_model)
#             return {"ok": True, "mode_used": "api", "text": text}
#         except Exception as e:
#             return {"ok": False, "mode_used": "api", "error": str(e), "text": ""}

#     # auto: local first, then api
#     try:
#         text = transcribe_local(audio_path, whisper_model)
#         return {"ok": True, "mode_used": "local", "text": text}
#     except Exception as e_local:
#         try:
#             text = transcribe_api(audio_path, api_model)
#             return {"ok": True, "mode_used": "api", "text": text, "fallback_from": str(e_local)}
#         except Exception as e_api:
#             return {
#                 "ok": False,
#                 "mode_used": "auto",
#                 "error": f"Local ASR failed: {e_local} | API ASR failed: {e_api}",
#                 "text": ""
#             }
