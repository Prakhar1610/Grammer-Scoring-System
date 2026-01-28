import requests

LT_URL = "https://api.languagetool.org/v2/check"

def correct_with_languagetool(text: str, language: str = "en-US"):
    """
    Returns:
      corrected_text (str)
      matches (list)  # raw LT matches for debugging/UI
    """
    text = (text or "").strip()
    if not text:
        return "", []

    data = {
        "text": text,
        "language": language,
    }

    r = requests.post(LT_URL, data=data, timeout=20)
    r.raise_for_status()
    out = r.json()

    matches = out.get("matches", [])

    # Apply replacements from end → start to keep offsets valid
    corrected = text
    for m in sorted(matches, key=lambda x: x["offset"], reverse=True):
        repls = m.get("replacements", [])
        if not repls:
            continue

        best = repls[0].get("value")
        if not best:
            continue

        off = m["offset"]
        length = m["length"]
        corrected = corrected[:off] + best + corrected[off + length:]

    return corrected, matches
