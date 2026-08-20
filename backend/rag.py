"""
rag.py — KnowledgeAI Core Engine
─────────────────────────────────────────────────────────
Features:
  ✓ Multi-format support    PDF / DOCX / PPTX / Excel / TXT
  ✓ Semantic chunking       Paragraph-aware, not word-count blind
  ✓ ChromaDB                Persistent vector storage (survives restarts)
  ✓ Hybrid search           BM25 keyword + ChromaDB semantic merged
  ✓ Multi-query retrieval   Expands question to 3 versions for better recall
  ✓ Confidence score        0–100% from ChromaDB distance
  ✓ Semantic cache          Similar questions return instantly
  ✓ Streaming               Word-by-word response via SSE
  ✓ Document summary        Auto-generated on upload
  ✓ Groq LLM                openai/gpt-oss-20b (fast, free)
"""

import io, os, json
import numpy as np
from groq import Groq
import chromadb
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer
import fitz  # PyMuPDF

try:    from docx  import Document as DocxDoc
except: DocxDoc = None

try:    from pptx  import Presentation
except: Presentation = None

try:    import openpyxl
except: openpyxl = None


# ─────────────────────────────────────────────────────────────────────────────
# 1. MODELS & CLIENTS
# ─────────────────────────────────────────────────────────────────────────────
print("[KnowledgeAI] Loading embedding model…")
embedder    = SentenceTransformer("all-MiniLM-L6-v2")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))
GROQ_MODEL  = "openai/gpt-oss-20b"

# Warm-up: prevents slow first request
embedder.encode(["warmup"], convert_to_numpy=True)
print("[KnowledgeAI] Ready.")


# ─────────────────────────────────────────────────────────────────────────────
# 2. CHROMADB  (persistent — survives server restarts)
# ─────────────────────────────────────────────────────────────────────────────
os.makedirs("chroma_db", exist_ok=True)
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection    = chroma_client.get_or_create_collection(
    "knowledge_ai", metadata={"hnsw:space": "l2"}
)


# ─────────────────────────────────────────────────────────────────────────────
# 3. GLOBAL STATE
# ─────────────────────────────────────────────────────────────────────────────
all_chunks:     list  = []   # [{text, doc_name, page, id}] — for BM25
doc_texts:      dict  = {}   # doc_name → full text (for compare / report)
doc_summaries:  dict  = {}   # doc_name → 2-sentence auto-summary
bm25_index            = None
semantic_cache: list  = []   # [{q_vec, answer, citations, confidence}]
chunk_counter:  int   = 0

def _rebuild_bm25():
    global bm25_index
    bm25_index = BM25Okapi([c["text"].split() for c in all_chunks]) if all_chunks else None


# ─────────────────────────────────────────────────────────────────────────────
# 4. STARTUP LOADER  (reload ChromaDB → in-memory on restart)
# ─────────────────────────────────────────────────────────────────────────────
def _load_from_chromadb():
    global chunk_counter
    try:
        ex = collection.get(include=["documents", "metadatas"])
        if not ex["ids"]:
            return
        print(f"[Startup] Reloading {len(ex['ids'])} chunks from ChromaDB…")
        for text, meta in zip(ex["documents"], ex["metadatas"]):
            name = meta.get("doc_name", "unknown")
            all_chunks.append({
                "text": text, "doc_name": name,
                "page": meta.get("page", 1),
            })
            doc_texts[name] = doc_texts.get(name, "") + " " + text
        chunk_counter = len(all_chunks)
        _rebuild_bm25()
        print(f"[Startup] {len(all_chunks)} chunks / {len(doc_texts)} docs loaded.")
    except Exception as e:
        print(f"[Startup] Warning: {e}")

_load_from_chromadb()


# ─────────────────────────────────────────────────────────────────────────────
# 5. FILE EXTRACTORS
# ─────────────────────────────────────────────────────────────────────────────
def _extract_pdf(data, name):
    doc   = fitz.open(stream=data, filetype="pdf")
    pages = []
    for n, page in enumerate(doc, 1):
        txt = page.get_text().strip()
        if txt:
            pages.append({"text": txt, "page": n, "doc_name": name})
    return pages, len(doc)

def _extract_docx(data, name):
    if not DocxDoc: return [], 0
    doc = DocxDoc(io.BytesIO(data))
    txt = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return ([{"text": txt, "page": 1, "doc_name": name}], 1) if txt else ([], 0)

def _extract_pptx(data, name):
    if not Presentation: return [], 0
    prs, slides = Presentation(io.BytesIO(data)), []
    for n, slide in enumerate(prs.slides, 1):
        txt = "\n".join(s.text for s in slide.shapes if hasattr(s,"text") and s.text.strip())
        if txt: slides.append({"text": txt, "page": n, "doc_name": name})
    return slides, len(prs.slides)

def _extract_excel(data, name):
    if not openpyxl: return [], 0
    wb, sheets = openpyxl.load_workbook(io.BytesIO(data)), []
    for n, ws in enumerate(wb.worksheets, 1):
        rows = [" | ".join(str(c) for c in row if c is not None) for row in ws.iter_rows(values_only=True)]
        txt  = f"Sheet: {ws.title}\n" + "\n".join(r for r in rows if r)
        if txt.strip(): sheets.append({"text": txt, "page": n, "doc_name": name})
    return sheets, len(wb.worksheets)

def _extract_txt(data, name):
    return [{"text": data.decode("utf-8", errors="ignore"), "page": 1, "doc_name": name}], 1

EXTRACTORS = {
    "pdf": _extract_pdf, "docx": _extract_docx, "pptx": _extract_pptx,
    "xlsx": _extract_excel, "xls": _extract_excel, "txt": _extract_txt,
}


# ─────────────────────────────────────────────────────────────────────────────
# 6. SEMANTIC CHUNKER  (paragraph-aware, not blind word-count)
# ─────────────────────────────────────────────────────────────────────────────
def _chunk(item, min_words=80, max_words=350):
    """
    Splits at natural paragraph boundaries.
    Merges short paragraphs until max_words, then starts a new chunk.
    This preserves complete ideas unlike fixed-size word splitting.
    """
    paragraphs = [p.strip() for p in item["text"].split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [item["text"]]

    chunks, current = [], ""
    for para in paragraphs:
        combined = (current + "\n\n" + para).strip()
        if len(combined.split()) > max_words and current:
            if len(current.split()) >= min_words:
                chunks.append({**item, "text": current.strip()})
            current = para
        else:
            current = combined

    if current and len(current.split()) >= min_words:
        chunks.append({**item, "text": current.strip()})

    # Fallback: if no chunks produced, return whole text as one chunk
    return chunks if chunks else [{**item, "text": item["text"]}]


# ─────────────────────────────────────────────────────────────────────────────
# 7. SEMANTIC CACHE
# ─────────────────────────────────────────────────────────────────────────────
def _cache_lookup(q_vec: np.ndarray, threshold=0.12):
    for e in semantic_cache:
        if float(np.linalg.norm(q_vec - e["q_vec"])) < threshold:
            return e
    return None

def _cache_save(q_vec, answer, citations, confidence):
    semantic_cache.append({
        "q_vec": q_vec, "answer": answer,
        "citations": citations, "confidence": confidence,
    })
    if len(semantic_cache) > 100:
        semantic_cache.pop(0)


# ─────────────────────────────────────────────────────────────────────────────
# 8. MULTI-QUERY EXPANSION  (rephrase question 2 ways → better BM25 recall)
# ─────────────────────────────────────────────────────────────────────────────
def _expand_query(question: str) -> list:
    """Returns [original, alt1, alt2] for broader BM25 keyword search."""
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content":
                f"Write 2 alternative search queries for this question.\n"
                f"Return ONLY the 2 queries, one per line, no numbering.\n"
                f"Question: {question}"}],
            temperature=0.3, max_tokens=80,
        )
        alts = [l.strip() for l in resp.choices[0].message.content.strip().split("\n") if l.strip()]
        return [question] + alts[:2]
    except Exception:
        return [question]


# ─────────────────────────────────────────────────────────────────────────────
# 9. DOCUMENT SUMMARY  (auto-generated on upload)
# ─────────────────────────────────────────────────────────────────────────────
def _generate_summary(text: str, filename: str) -> str:
    try:
        resp = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content":
                f"Summarize this document in exactly 2 sentences:\n\n{text[:2000]}"}],
            temperature=0, max_tokens=100,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# 10. SHARED RETRIEVAL  (used by both answer_question and stream_answer)
# ─────────────────────────────────────────────────────────────────────────────
def _retrieve(question: str, q_vec: np.ndarray):
    """
    Hybrid retrieval: ChromaDB semantic + BM25 keyword (multi-query).
    Returns (top_hits, citations, confidence, context_string).
    """
    # Semantic search — ChromaDB
    n          = min(10, len(all_chunks))
    chroma_res = collection.query(
        query_embeddings=[q_vec.tolist()], n_results=n,
        include=["documents", "metadatas", "distances"],
    )
    semantic_hits = [
        {"text":     chroma_res["documents"][0][i],
         "doc_name": chroma_res["metadatas"][0][i]["doc_name"],
         "page":     chroma_res["metadatas"][0][i]["page"],
         "distance": chroma_res["distances"][0][i]}
        for i in range(len(chroma_res["documents"][0]))
    ]

    # BM25 keyword search — multi-query expansion
    bm25_hits = []
    if bm25_index:
        queries = _expand_query(question)   # [original, alt1, alt2]
        seen_bm25, bm25_hits = set(), []
        for q in queries:
            scores   = bm25_index.get_scores(q.split())
            top_idxs = np.argsort(scores)[::-1][:8]
            for i in top_idxs:
                if scores[i] > 0:
                    key = f"{all_chunks[i]['doc_name']}_{all_chunks[i]['page']}_{all_chunks[i]['text'][:30]}"
                    if key not in seen_bm25:
                        seen_bm25.add(key)
                        bm25_hits.append({
                            "text":     all_chunks[i]["text"],
                            "doc_name": all_chunks[i]["doc_name"],
                            "page":     all_chunks[i]["page"],
                            "distance": 1.0,
                        })

    # Merge + deduplicate (semantic first = higher priority)
    seen, candidates = set(), []
    for hit in semantic_hits + bm25_hits:
        key = f"{hit['doc_name']}_{hit['page']}_{hit['text'][:40]}"
        if key not in seen:
            seen.add(key)
            candidates.append(hit)

    top_hits = candidates[:3]

    # Confidence from ChromaDB distance (0=perfect, 2=worst)
    best_dist  = semantic_hits[0]["distance"] if semantic_hits else 2.0
    confidence = int(min(100, max(0, (1 - best_dist / 2) * 100)))

    # Citations
    seen_c, citations = set(), []
    for h in top_hits:
        key = f"{h['doc_name']}|{h['page']}"
        if key not in seen_c:
            seen_c.add(key)
            citations.append({"doc": h["doc_name"], "page": h["page"]})

    # Context block sent to LLM
    context = "\n\n---\n\n".join(
        f"[{h['doc_name']}, Page {h['page']}]\n{h['text']}"
        for h in top_hits
    )
    return top_hits, citations, confidence, context


def _build_prompt(question: str, context: str, chat_history: list) -> str:
    history = "\n".join(
        f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}"
        for m in chat_history[-4:]
    )
    return f"""You are an enterprise document assistant.
Answer ONLY from the context below. Cite sources inline as [DocName, Page N].
If the answer is not in the context, say "I couldn't find that in the uploaded documents."

Previous conversation:
{history or "None"}

Context:
{context}

Question: {question}
Answer:"""


# ─────────────────────────────────────────────────────────────────────────────
# 11. PUBLIC: process_document
# ─────────────────────────────────────────────────────────────────────────────
def process_document(data: bytes, filename: str) -> dict:
    global chunk_counter
    ext = filename.lower().rsplit(".", 1)[-1]
    fn  = EXTRACTORS.get(ext)
    if not fn:
        return {"error": f"Unsupported file type: .{ext}"}

    page_items, total_pages = fn(data, filename)
    if not page_items:
        return {"error": "No text extracted. File may be empty, scanned, or corrupted."}

    # Save full text for compare / report
    doc_texts[filename] = "\n\n".join(p["text"] for p in page_items)

    # Auto-generate 2-sentence summary
    summary = _generate_summary(doc_texts[filename], filename)
    doc_summaries[filename] = summary

    # Semantic chunk
    new_chunks = [c for p in page_items for c in _chunk(p)]

    # Embed + store in ChromaDB
    texts      = [c["text"] for c in new_chunks]
    embeddings = embedder.encode(texts, convert_to_numpy=True, show_progress_bar=False)

    ids, docs, metas, vecs = [], [], [], []
    for i, (chunk, vec) in enumerate(zip(new_chunks, embeddings)):
        cid = f"{filename}_c{chunk_counter + i}"
        chunk["id"] = cid
        ids.append(cid)
        docs.append(chunk["text"])
        metas.append({"doc_name": chunk["doc_name"], "page": int(chunk["page"])})
        vecs.append(vec.tolist())

    collection.add(documents=docs, embeddings=vecs, metadatas=metas, ids=ids)
    chunk_counter += len(new_chunks)

    all_chunks.extend(new_chunks)
    _rebuild_bm25()

    return {
        "filename":      filename,
        "pages":         total_pages,
        "chunks":        len(new_chunks),
        "total_indexed": len(all_chunks),
        "summary":       summary,
        "status":        "ready",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 12. PUBLIC: answer_question  (non-streaming fallback)
# ─────────────────────────────────────────────────────────────────────────────
def answer_question(question: str, chat_history: list = []) -> dict:
    if not all_chunks:
        return {"error": "No documents uploaded yet."}

    q_vec  = embedder.encode([question], convert_to_numpy=True)[0]
    cached = _cache_lookup(q_vec)
    if cached:
        return {**cached, "from_cache": True}

    _, citations, confidence, context = _retrieve(question, q_vec)
    prompt = _build_prompt(question, context, chat_history)

    resp   = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0, max_tokens=512,
    )
    answer = resp.choices[0].message.content
    _cache_save(q_vec, answer, citations, confidence)
    return {"answer": answer, "citations": citations, "confidence": confidence, "from_cache": False}


# ─────────────────────────────────────────────────────────────────────────────
# 13. PUBLIC: stream_answer  (SSE generator for streaming endpoint)
# ─────────────────────────────────────────────────────────────────────────────
def stream_answer(question: str, chat_history: list = []):
    """
    Yields Server-Sent Events:
      data: {"type":"meta",    "citations":[...], "confidence":87, "from_cache":false}
      data: {"type":"text",    "content":"word"}
      data: [DONE]
    """
    if not all_chunks:
        yield f"data: {json.dumps({'type':'error','content':'No documents uploaded yet.'})}\n\n"
        return

    q_vec  = embedder.encode([question], convert_to_numpy=True)[0]
    cached = _cache_lookup(q_vec)

    if cached:
        yield f"data: {json.dumps({'type':'meta','citations':cached['citations'],'confidence':cached['confidence'],'from_cache':True})}\n\n"
        yield f"data: {json.dumps({'type':'text','content':cached['answer']})}\n\n"
        yield "data: [DONE]\n\n"
        return

    _, citations, confidence, context = _retrieve(question, q_vec)

    # Send citations immediately — user sees sources before full answer
    yield f"data: {json.dumps({'type':'meta','citations':citations,'confidence':confidence,'from_cache':False})}\n\n"

    prompt      = _build_prompt(question, context, chat_history)
    stream      = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        stream=True, temperature=0, max_tokens=512,
    )
    full_answer = ""
    for chunk in stream:
        token = chunk.choices[0].delta.content or ""
        if token:
            full_answer += token
            yield f"data: {json.dumps({'type':'text','content':token})}\n\n"

    yield "data: [DONE]\n\n"
    _cache_save(q_vec, full_answer, citations, confidence)


# ─────────────────────────────────────────────────────────────────────────────
# 14. UTILITIES
# ─────────────────────────────────────────────────────────────────────────────
def clear_documents():
    global all_chunks, doc_texts, doc_summaries, bm25_index, semantic_cache, chunk_counter
    try:
        ids = collection.get()["ids"]
        if ids: collection.delete(ids=ids)
    except Exception:
        pass
    all_chunks.clear(); doc_texts.clear(); doc_summaries.clear()
    semantic_cache.clear(); bm25_index = None; chunk_counter = 0

def get_doc_text(name: str)    -> str:  return doc_texts.get(name, "")
def get_doc_summary(name: str) -> str:  return doc_summaries.get(name, "")
def list_doc_names()           -> list: return list(doc_texts.keys())
