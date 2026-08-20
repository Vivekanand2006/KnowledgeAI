"""report.py — Groq-powered AI report generator with PDF export"""
import os
from groq import Groq
from datetime import datetime
from rag import get_doc_text, doc_texts

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))
os.makedirs("reports", exist_ok=True)

PROMPTS = {
    "summary":         "Write a comprehensive summary with: Key Topics, Main Points, Important Details, and Conclusion.",
    "executive":       "Write a C-level executive summary with: Business Context, Key Findings, Risks & Opportunities, and Recommended Actions.",
    "meeting_minutes": "Extract meeting minutes with: Date & Attendees (if mentioned), Agenda Items, Decisions Made, Action Items, and Next Steps.",
}

def generate_report(doc_name=None, report_type="summary") -> dict:
    if doc_name:
        text, source = get_doc_text(doc_name), doc_name
        if not text: return {"error": f"'{doc_name}' not found. Upload it first."}
    else:
        if not doc_texts: return {"error": "No documents uploaded yet."}
        text   = "\n\n=====\n\n".join(f"[{k}]\n{v}" for k, v in doc_texts.items())
        source = "All documents"

    prompt = f"""{PROMPTS.get(report_type, PROMPTS["summary"])}

Source: {source}
Date: {datetime.now().strftime("%B %d, %Y")}

Content:
{text[:5000]}

Use clear headings. Be concise but thorough."""

    resp    = groq_client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[{"role": "user", "content": prompt}],
        temperature=0, max_tokens=2048,
    )
    content = resp.choices[0].message.content
    fname   = f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    pdf_ok  = _make_pdf(content, source, report_type, fname)

    return {
        "report":       content,
        "source":       source,
        "type":         report_type,
        "pdf_filename": fname if pdf_ok else None,
    }


def _make_pdf(content, source, rtype, filename):
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles    import ParagraphStyle
        from reportlab.lib.units     import inch
        from reportlab.lib.colors    import HexColor
        from reportlab.platypus      import SimpleDocTemplate, Paragraph, Spacer

        doc  = SimpleDocTemplate(f"reports/{filename}", pagesize=A4,
                                 rightMargin=inch, leftMargin=inch,
                                 topMargin=inch, bottomMargin=inch)
        T = ParagraphStyle("t", fontSize=22, fontName="Helvetica-Bold", spaceAfter=4,  textColor=HexColor("#111827"))
        M = ParagraphStyle("m", fontSize=11, fontName="Helvetica",      spaceAfter=2,  textColor=HexColor("#6B7280"))
        H = ParagraphStyle("h", fontSize=13, fontName="Helvetica-Bold", spaceBefore=14,spaceAfter=4,  textColor=HexColor("#1F2937"))
        B = ParagraphStyle("b", fontSize=11, fontName="Helvetica",      spaceAfter=6,  leading=17, textColor=HexColor("#374151"))

        story = [
            Paragraph("AI Generated Report", T),
            Paragraph(f"Source: {source}  |  Type: {rtype.replace('_',' ').title()}", M),
            Paragraph(f"Generated: {datetime.now().strftime('%B %d, %Y at %H:%M')}", M),
            Spacer(1, 16),
        ]
        for line in content.split("\n"):
            line = line.strip()
            if not line:
                story.append(Spacer(1, 6))
            elif line.isupper() or (line.endswith(":") and len(line) < 60):
                story.append(Paragraph(line, H))
            else:
                safe = line.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
                story.append(Paragraph(safe, B))
        doc.build(story)
        return True
    except Exception as e:
        print(f"PDF error: {e}")
        return False
