"""
citation_resolver.py
--------------------
Verifies whether retrieved document sources support the generated AI answer.

Returns:
[
    {
        "doc": "...",
        "page": 1,
        "status": "verified",
        "confidence": 92,
        "exact_quote": "...",
        "reason": "..."
    }
]
"""

from groq import Groq


# ============================================================
# GROQ CONFIGURATION
# ============================================================

# Put your NEW Groq API key here.
# Example:
# GROQ_API_KEY = "gsk_xxxxxxxxxxxxxxxxx"
import os
from dotenv import load_dotenv
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing")

groq_client = Groq(api_key=GROQ_API_KEY)

# Model that is available in your Groq account
GROQ_MODEL = "openai/gpt-oss-20b"


# ============================================================
# MAIN CITATION RESOLVER
# ============================================================

def resolve_citations(answer: str, top_hits: list) -> list:
    """
    Verify each retrieved source against the generated AI answer.

    Parameters:
        answer: AI-generated answer.
        top_hits: Retrieved document chunks.

    Returns:
        List of citation verification results.
    """

    if not top_hits:
        return []

    results = []

    for hit in top_hits:
        result = _verify_one(answer, hit)
        results.append(result)

    return results


# ============================================================
# VERIFY ONE SOURCE
# ============================================================

def _verify_one(answer: str, hit: dict) -> dict:
    """
    Verify whether one retrieved source supports the AI answer.
    """

    doc_name = hit.get("doc_name", "Unknown document")
    page = hit.get("page", 1)
    source_text = hit.get("text", "")

    # --------------------------------------------------------
    # Verification prompt
    # --------------------------------------------------------

    prompt = f"""
You are a citation verification system.

Your job is to determine whether the SOURCE supports the AI ANSWER.

Reply in EXACTLY these 4 lines:

STATUS: verified
CONFIDENCE: 90
QUOTE: exact phrase from source or NONE
REASON: one sentence explanation

STATUS rules:
- verified = source clearly supports the answer
- partial = source supports only part of the answer
- incorrect = source contradicts the answer
- unrelated = source is not relevant to the answer

CONFIDENCE rules:
- Integer from 0 to 100
- 90-100 = very strong support
- 70-89 = good support
- 40-69 = partial or weak support
- 0-39 = little or no support

QUOTE rules:
- Must be copied EXACTLY from the source.
- Keep it short.
- Do not invent or rewrite the quote.
- Use NONE when no useful quote exists.

REASON rules:
- One short sentence.
- Explain why the source supports, partially supports,
  contradicts, or is unrelated to the answer.

AI ANSWER:
{answer[:1200]}

SOURCE:
Document: {doc_name}
Page: {page}

{source_text[:1800]}

Reply ONLY with the four required lines.
Do NOT provide reasoning or any additional text.
"""

    try:

        # ----------------------------------------------------
        # Call Groq
        # ----------------------------------------------------

        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0,
            max_tokens=200,
            include_reasoning=False
        )

        # ----------------------------------------------------
        # Read final answer
        # ----------------------------------------------------

        message = response.choices[0].message

        text = (message.content or "").strip()

        print(
            f"[CitationResolver] Response for "
            f"{doc_name} page {page}: {text[:300]}"
        )

        # ----------------------------------------------------
        # Safety check
        # ----------------------------------------------------

        if not text:
            print(
                f"[CitationResolver] Empty response from Groq "
                f"for {doc_name} page {page}"
            )

            return {
                "doc": doc_name,
                "page": page,
                "status": "unverified",
                "confidence": 0,
                "exact_quote": "",
                "reason": "Groq returned an empty verification response"
            }

        # ----------------------------------------------------
        # Default values
        # ----------------------------------------------------

        status = "unverified"
        confidence = 0
        exact_quote = ""
        reason = ""

        # ----------------------------------------------------
        # Parse four-line response
        # ----------------------------------------------------

        for line in text.splitlines():

            line = line.strip()

            if not line:
                continue

            if ":" not in line:
                continue

            key, value = line.split(":", 1)

            key = key.strip().upper()
            value = value.strip()

            # ------------------------------------------------
            # STATUS
            # ------------------------------------------------

            if key == "STATUS":

                value_lower = value.lower().strip(" .,:;")

                if value_lower in {
                    "verified",
                    "partial",
                    "incorrect",
                    "unrelated"
                }:
                    status = value_lower

            # ------------------------------------------------
            # CONFIDENCE
            # ------------------------------------------------

            elif key == "CONFIDENCE":

                try:

                    # Example:
                    # "95"
                    # "95%"
                    # "95 percent"

                    cleaned = value.strip(" .,;%")
                    number = cleaned.split()[0]

                    confidence = int(number)

                    confidence = max(
                        0,
                        min(100, confidence)
                    )

                except (ValueError, IndexError):

                    confidence = 0

            # ------------------------------------------------
            # QUOTE
            # ------------------------------------------------

            elif key == "QUOTE":

                if value.upper().strip(" .") == "NONE":
                    exact_quote = ""
                else:
                    exact_quote = value

            # ------------------------------------------------
            # REASON
            # ------------------------------------------------

            elif key == "REASON":

                reason = value

        # ----------------------------------------------------
        # Build result
        # ----------------------------------------------------

        result = {
            "doc": doc_name,
            "page": page,
            "status": status,
            "confidence": confidence,
            "exact_quote": exact_quote,
            "reason": reason
        }

        # ----------------------------------------------------
        # Debug output
        # ----------------------------------------------------

        print(
            f"[CitationResolver] "
            f"{doc_name} | "
            f"Page {page} | "
            f"{status} | "
            f"{confidence}%"
        )

        if exact_quote:
            print(
                f"[CitationResolver] Quote: "
                f"{exact_quote[:150]}"
            )

        if reason:
            print(
                f"[CitationResolver] Reason: "
                f"{reason[:200]}"
            )

        return result

    # ========================================================
    # ERROR HANDLING
    # ========================================================

    except Exception as e:

        print(
            f"[CitationResolver] Error verifying "
            f"{doc_name} page {page}: {e}"
        )

        return {
            "doc": doc_name,
            "page": page,
            "status": "unverified",
            "confidence": 0,
            "exact_quote": "",
            "reason": "Citation verification failed"
        }