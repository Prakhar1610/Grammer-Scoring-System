import re

def basic_punctuate(text: str) -> str:
    if not text:
        return ""

    text = text.strip()

    # Capitalize first letter
    text = text[0].upper() + text[1:]

    # Add period if missing
    if text[-1] not in ".!?":
        text += "."

    # --- Comma rules (safe & explainable) ---

    # 1) Introductory adverbs / phrases
    intro_words = [
        "Yesterday", "Today", "Tomorrow",
        "However", "Therefore", "Moreover",
        "After that", "In addition", "For example"
    ]

    for word in intro_words:
        if text.startswith(word + " "):
            text = text.replace(word + " ", word + ", ", 1)

    # 2) Add comma before coordinating conjunctions in long sentences
    # e.g. "... vegetables and I compared prices ..."
    text = re.sub(
        r"(\w{4,})\s+(and|but|so|because)\s+I\s+",
        r"\1, \2 I ",
        text,
        flags=re.IGNORECASE
    )

    # 3) Lists: fruits and vegetables → fruits, and vegetables
    text = re.sub(
        r"(\w+)\s+and\s+(\w+)",
        r"\1, and \2",
        text,
        count=1
    )

    return text
