import re

def ensure_sentence_end(text: str) -> str:
    if not text or not text.strip():
        return ""

    t = text.strip()

    # Capitalize first letter
    t = t[0].upper() + t[1:]

    # Add final punctuation if missing
    if t[-1] not in ".!?":
        t += "."

    # Fix spaces before punctuation
    t = re.sub(r"\s+([,.!?])", r"\1", t)

    # Ensure space after punctuation
    t = re.sub(r"([,.!?])([A-Za-z])", r"\1 \2", t)

    return t
