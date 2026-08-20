from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import uvicorn, os
from datetime import datetime
from rag import (process_document, answer_question, stream_answer,
                 clear_documents, doc_texts)
from comparison import compare_documents
from report import generate_report

app = FastAPI(title="KnowledgeAI — Enterprise Document Assistant")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"],
)

stats = {
    "documents":         [],
    "total_documents":   0,
    "questions_asked":   0,
    "comparisons_done":  0,
    "reports_generated": 0,
    "recent_questions":  [],
}

class AskRequest(BaseModel):
    question:     str
    chat_history: List[dict] = []

class CompareRequest(BaseModel):
    doc1_name: str
    doc2_name: str

class ReportRequest(BaseModel):
    doc_name:    Optional[str] = None
    report_type: str = "summary"


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status":    "ok",
        "documents": stats["total_documents"],
        "indexed":   sum(d.get("chunks", 0) for d in stats["documents"]),
    }


# ── Upload ────────────────────────────────────────────────────────────────────
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    contents = await file.read()
    result   = process_document(contents, file.filename)
    if "error" not in result:
        existing = [d["name"] for d in stats["documents"]]
        if file.filename not in existing:
            stats["documents"].append({
                "name":        file.filename,
                "uploaded_at": datetime.now().strftime("%d %b %Y, %H:%M"),
                "chunks":      result["chunks"],
                "pages":       result.get("pages", 0),
                "summary":     result.get("summary", ""),
            })
            stats["total_documents"] += 1
    return result


# ── Ask (non-streaming fallback) ──────────────────────────────────────────────
@app.post("/ask")
async def ask(body: AskRequest):
    result = answer_question(body.question, body.chat_history)
    _log_question(body.question)
    return result


# ── Ask (streaming) ───────────────────────────────────────────────────────────
@app.post("/ask/stream")
async def ask_stream(body: AskRequest):
    async def event_stream():
        for chunk in stream_answer(body.question, body.chat_history):
            yield chunk
    _log_question(body.question)
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        },
    )


# ── Compare ───────────────────────────────────────────────────────────────────
@app.post("/compare")
async def compare(body: CompareRequest):
    result = compare_documents(body.doc1_name, body.doc2_name)
    stats["comparisons_done"] += 1
    return result


# ── Report ────────────────────────────────────────────────────────────────────
@app.post("/report")
async def report(body: ReportRequest):
    result = generate_report(body.doc_name, body.report_type)
    stats["reports_generated"] += 1
    return result


@app.get("/report/download/{filename}")
async def download_report(filename: str):
    path = f"reports/{filename}"
    if os.path.exists(path):
        return FileResponse(path, media_type="application/pdf", filename=filename)
    return {"error": "File not found"}


# ── Stats ─────────────────────────────────────────────────────────────────────
@app.get("/stats")
async def get_stats():
    return {**stats}


# ── Clear ─────────────────────────────────────────────────────────────────────
@app.delete("/documents")
async def clear_all():
    clear_documents()
    stats["documents"]       = []
    stats["total_documents"] = 0
    return {"message": "All documents cleared"}


# ── Helper ────────────────────────────────────────────────────────────────────
def _log_question(q: str):
    stats["questions_asked"] += 1
    stats["recent_questions"].append(q[:80])
    stats["recent_questions"] = stats["recent_questions"][-10:]


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
