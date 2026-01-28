import requests

def correct_with_languagetool(text: str, language="en-US"):
    if not text or not text.strip():
        return {"ok": True, "corrected": "", "matches": [], "mode_used": "languagetool"}

    url = "https://api.languagetool.org/v2/check"
    r = requests.post(url, data={"text": text, "language": language}, timeout=15)
    res = r.json()

    matches = res.get("matches", [])

    # Apply edits from end -> start so offsets stay valid
    corrected = text
    for m in sorted(matches, key=lambda x: x["offset"], reverse=True):
        reps = m.get("replacements", [])
        if not reps:
            continue
        repl = reps[0]["value"]
        start = m["offset"]
        end = start + m["length"]
        corrected = corrected[:start] + repl + corrected[end:]

    return {
        "ok": True,
        "corrected": corrected,
        "matches": matches,
        "mode_used": "languagetool",
    }
