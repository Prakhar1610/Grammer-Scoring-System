from typing import Dict, Any, List

def correct_grammar(text: str) -> Dict[str, Any]:
    """
    Returns:
      {
        "ok": bool,
        "corrected": str,
        "matches": [ { "message":..., "replacements":[...], "offset":..., "length":... } ],
        "mode_used": "languagetool_local" | "none",
        "error": str|None
      }
    """
    text = (text or "").strip()
    if not text:
        return {"ok": False, "corrected": "", "matches": [], "mode_used": "none", "error": "Empty transcript"}

    try:
        import language_tool_python
        tool = language_tool_python.LanguageTool("en-US")

        matches = tool.check(text)
        corrected = language_tool_python.utils.correct(text, matches)

        compact: List[dict] = []
        for m in matches:
            compact.append({
                "message": m.message,
                "offset": m.offset,
                "length": m.errorLength,
                "replacements": [r.value for r in (m.replacements or [])][:5]
            })

        return {
            "ok": True,
            "corrected": corrected,
            "matches": compact,
            "mode_used": "languagetool_local",
            "error": None
        }

    except Exception as e:
        # Most common: Java not installed / LT init fails
        return {
            "ok": False,
            "corrected": text,   # fallback: return original
            "matches": [],
            "mode_used": "none",
            "error": str(e)
        }
