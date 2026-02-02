import re

def punctuate_rules(text: str) -> str:
    if not text or not text.strip():
        return ""

    t = " ".join(text.strip().split())

    # Fix lowercase i
    t = re.sub(r"\bi\b", "I", t)

    # Capitalize first character
    t = t[0].upper() + t[1:] if t else t

    # Add comma after common starters
    starters = ["Yesterday", "Today", "Tomorrow", "Also", "However", "Therefore", "After that", "Then"]
    for s in starters:
        if t.startswith(s + " "):
            t = t.replace(s + " ", s + ", ", 1)

    # Add commas before conjunctions in long sentences (simple heuristic)
    t = re.sub(r"\s+(and|but|so|because|while)\s+", r", \1 ", t)

    # Add a period at the end if missing
    if t and t[-1] not in ".!?":
        t += "."

    # Split into sentences using " I " as a weak indicator (optional)
    # This can help create multiple sentences
    t = re.sub(r"\.\s+I\s+", ". I ", t)

    return t
