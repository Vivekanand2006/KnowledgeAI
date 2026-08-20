"""comparison.py — Groq-powered document comparison"""
import os
from groq import Groq
from rag import get_doc_text

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

def compare_documents(doc1_name: str, doc2_name: str) -> dict:
    d1 = get_doc_text(doc1_name)
    d2 = get_doc_text(doc2_name)

    if not d1: return {"error": f"'{doc1_name}' not found. Upload it first."}
    if not d2: return {"error": f"'{doc2_name}' not found. Upload it first."}

    prompt = f"""Compare these two documents. Use EXACTLY these headings:

DOCUMENT 1: {doc1_name}
{d1[:3000]}

---

DOCUMENT 2: {doc2_name}
{d2[:3000]}

---

OVERVIEW:
[2-3 sentences on what each document is about]

KEY SIMILARITIES:
- [point 1]
- [point 2]
- [point 3]

KEY DIFFERENCES:
- [point 1]
- [point 2]
- [point 3]

CRITICAL CHANGES:
[Dates, terms, clauses, or numbers that differ and need attention]

RECOMMENDATION:
[Which document is more favorable/complete and why]"""

    resp = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": prompt}],
        temperature=0, max_tokens=2048,
    )
    return {
        "doc1":       doc1_name,
        "doc2":       doc2_name,
        "comparison": resp.choices[0].message.content,
    }
