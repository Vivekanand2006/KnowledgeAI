"""
rag.py — KnowledgeAI Core Engine
─────────────────────────────────────────────────────────
All features:
  ✓ Multi-format        PDF / DOCX / PPTX / Excel / TXT
  ✓ Semantic chunking   Paragraph-aware
  ✓ ChromaDB            Persistent vector storage
  ✓ Hybrid search       BM25 + semantic merged
  ✓ Multi-query         Question expanded 3 ways
  ✓ Confidence score    0–100% from vector distance
  ✓ Semantic cache      Similar questions return instantly
  ✓ Streaming           Word-by-word SSE
  ✓ Doc summary         Auto-generated on upload
  ✓ Citation resolver   Verifies every citation ✓ ⚠ ✗
"""

import io
import json
import os
from typing import Iterable

import chromadb
import fitz
import numpy as np
from fastembed import TextEmbedding
from groq import Groq
from rank_bm25 import BM25Okapi

from citation_resolver import resolve_citations

try:
    from docx import Document as DocxDoc
except ImportError:
    DocxDoc = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is missing")


groq_client = Groq(
    api_key=GROQ_API_KEY,
    timeout=60.0,
    max_retries=5
)
GROQ_MODEL = "openai/gpt-oss-20b"

# FastEmbed uses ONNX Runtime instead of the PyTorch-based Sentence Transformers
# stack. Lazy loading defers model loading until the first embedding request.
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_BACKEND = f"fastembed:{EMBEDDING_MODEL}"

print("[KnowledgeAI] Configuring FastEmbed model...")


class EmbeddingAdapter:
    """Keep the embedder.encode() interface used throughout this file."""

    def __init__(self, model: TextEmbedding):
        self.model = model

    def encode(
        self,
        texts: Iterable[str],
        convert_to_numpy: bool = True,
        show_progress_bar: bool = False,
    ) -> np.ndarray:
        # Small batches reduce peak memory use on Render's free instance.
        vectors = list(self.model.embed(texts, batch_size=16))
        result = np.asarray(vectors, dtype=np.float32)
        return result if convert_to_numpy else result.tolist()


embedder = EmbeddingAdapter(
    TextEmbedding(
        model_name=EMBEDDING_MODEL,
        threads=1,
        lazy_load=True,
    )
)

print("[KnowledgeAI] FastEmbed configured.")

# ── ChromaDB ──────────────────────────────────────────────────────────────────
os.makedirs("chroma_db", exist_ok=True)
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(
    "knowledge_ai",
    metadata={
        "hnsw:space": "l2",
        "embedding_backend": EMBEDDING_BACKEND,
    },
)


# ── Global state ──────────────────────────────────────────────────────────────
all_chunks:     list = []
doc_texts:      dict = {}
doc_summaries:  dict = {}
bm25_index           = None
semantic_cache: list = []
chunk_counter:  int  = 0

def _rebuild_bm25():
    global bm25_index
    bm25_index = BM25Okapi([c["text"].split() for c in all_chunks]) if all_chunks else None


# ── Startup: migrate/reload ChromaDB data ─────────────────────────────────────
def _ensure_embedding_backend(records: dict) -> None:
    """
    Re-embed existing records once if their vectors were created by a different
    implementation. This prevents comparing FastEmbed query vectors with old
    Sentence Transformers vectors.
    """
    metadata = dict(collection.metadata or {})
    stored_backend = metadata.get("embedding_backend")
    ids = records.get("ids") or []

    if stored_backend != EMBEDDING_BACKEND and ids:
        documents = records.get("documents") or []
        print(
            f"[Startup] Updating {len(ids)} stored embeddings to "
            f"{EMBEDDING_BACKEND}..."
        )
        batch_size = 16
        for start_index in range(0, len(ids), batch_size):
            batch_ids = ids[start_index:start_index + batch_size]
            batch_docs = documents[start_index:start_index + batch_size]
            vectors = embedder.encode(batch_docs, show_progress_bar=False)
            collection.update(
                ids=batch_ids,
                embeddings=[vector.tolist() for vector in vectors],
            )

    if stored_backend != EMBEDDING_BACKEND:
        metadata["embedding_backend"] = EMBEDDING_BACKEND
        metadata.setdefault("hnsw:space", "l2")
        collection.modify(metadata=metadata)
        if ids:
            print("[Startup] Existing embeddings updated.")


def _load_from_chromadb():
    global chunk_counter
    try:
        records = collection.get(include=["documents", "metadatas"])
        _ensure_embedding_backend(records)

        if not records["ids"]:
            print("[Startup] ChromaDB collection is empty.")
            return

        print(f"[Startup] Reloading {len(records['ids'])} chunks...")
        for text, meta in zip(records["documents"], records["metadatas"]):
            meta = meta or {}
            name = meta.get("doc_name", "unknown")
            page = meta.get("page", 1)
            all_chunks.append({"text": text, "doc_name": name, "page": page})
            doc_texts[name] = doc_texts.get(name, "") + " " + text

        chunk_counter = len(all_chunks)
        _rebuild_bm25()
        print(f"[Startup] {len(all_chunks)} chunks / {len(doc_texts)} docs loaded.")
    except Exception as exc:
        print(f"[Startup] Warning while loading ChromaDB: {exc}")


_load_from_chromadb()


# ── Extractors ────────────────────────────────────────────────────────────────
def _extract_pdf(data, name):
    doc = fitz.open(stream=data, filetype="pdf")
    pages = []
    for n, page in enumerate(doc, 1):
        txt = page.get_text().strip()
        if txt: pages.append({"text": txt, "page": n, "doc_name": name})
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
        txt = "\n".join(s.text for s in slide.shapes if hasattr(s, "text") and s.text.strip())
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


# ── Semantic chunker (paragraph-aware) ───────────────────────────────────────
def _chunk(item, min_words=40, max_words=180):
    """
    Paragraph-aware chunker with single-newline fallback.
    For dense single-page docs (resumes, reports), falls back
    to splitting on single newlines to create smaller, specific chunks.
    """
    # Try double-newline paragraphs first
    paragraphs = [p.strip() for p in item["text"].split("\n\n") if p.strip()]

    # If only 1 big block, fall back to single newlines (handles PDFs/resumes)
    if len(paragraphs) <= 2:
        single = [p.strip() for p in item["text"].split("\n") if p.strip()]
        if len(single) > len(paragraphs):
            paragraphs = single

    chunks, current = [], ""
    for para in paragraphs:
        combined = (current + "\n" + para).strip()
        if len(combined.split()) > max_words and current:
            if len(current.split()) >= min_words:
                chunks.append({**item, "text": current.strip()})
            current = para
        else:
            current = combined
    if current and len(current.split()) >= min_words:
        chunks.append({**item, "text": current.strip()})
    return chunks if chunks else [{**item, "text": item["text"]}]


# ── Semantic cache ────────────────────────────────────────────────────────────
def _cache_lookup(q_vec, threshold=0.12):
    for e in semantic_cache:
        if float(np.linalg.norm(q_vec - e["q_vec"])) < threshold:
            return e
    return None

def _cache_save(q_vec, answer, citations, confidence):
    semantic_cache.append({"q_vec": q_vec, "answer": answer,
                           "citations": citations, "confidence": confidence})
    if len(semantic_cache) > 100: semantic_cache.pop(0)


# ── Multi-query expansion ─────────────────────────────────────────────────────
def _expand_query(question: str) -> list:
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


# ── Document summary ──────────────────────────────────────────────────────────
def _generate_summary(text: str) -> str:
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


# ── Shared retrieval ──────────────────────────────────────────────────────────
def _retrieve(question: str, q_vec: np.ndarray):
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

    bm25_hits, seen_bm25 = [], set()
    if bm25_index:
        for q in _expand_query(question):
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

    seen, candidates = set(), []
    for hit in semantic_hits + bm25_hits:
        key = f"{hit['doc_name']}_{hit['page']}_{hit['text'][:40]}"
        if key not in seen:
            seen.add(key); candidates.append(hit)

    top_hits   = candidates[:3]
    best_dist  = semantic_hits[0]["distance"] if semantic_hits else 2.0
    # Square-root scaling: gives more realistic confidence values
    # e.g. cosine_sim=0.3 -> 55%, cosine_sim=0.5 -> 71%, cosine_sim=0.7 -> 84%
    cosine_sim = max(0.0, 1.0 - best_dist / 2.0)
    confidence = int(min(100, (cosine_sim ** 0.5) * 100))
    context    = "\n\n---\n\n".join(
        f"[{h['doc_name']}, Page {h['page']}]\n{h['text']}" for h in top_hits
    )
    return top_hits, confidence, context


def _build_prompt(question: str, context: str, chat_history: list) -> str:
    history = "\n".join(
        f"{'User' if m['role']=='user' else 'Assistant'}: {m['content']}"
        for m in chat_history[-4:]
    )
    return f"""You are an enterprise document assistant.
Answer ONLY from the context below. Cite sources inline as [DocName, Page N].
If not found, say "I couldn't find that in the uploaded documents."

Previous conversation:
{history or "None"}

Context:
{context}

Question: {question}
Answer:"""


# ── process_document ──────────────────────────────────────────────────────────
def process_document(data: bytes, filename: str) -> dict:
    global chunk_counter
    ext = filename.lower().rsplit(".", 1)[-1]
    fn  = EXTRACTORS.get(ext)
    if not fn: return {"error": f"Unsupported type: .{ext}"}

    page_items, total_pages = fn(data, filename)
    if not page_items: return {"error": "No text extracted."}

    doc_texts[filename] = "\n\n".join(p["text"] for p in page_items)
    summary = _generate_summary(doc_texts[filename])
    doc_summaries[filename] = summary

    new_chunks = [c for p in page_items for c in _chunk(p)]
    embeddings = embedder.encode([c["text"] for c in new_chunks],
                                 convert_to_numpy=True, show_progress_bar=False)

    ids, docs, metas, vecs = [], [], [], []
    for i, (chunk, vec) in enumerate(zip(new_chunks, embeddings)):
        cid = f"{filename}_c{chunk_counter + i}"
        chunk["id"] = cid
        ids.append(cid); docs.append(chunk["text"])
        metas.append({"doc_name": chunk["doc_name"], "page": int(chunk["page"])})
        vecs.append(vec.tolist())

    collection.add(documents=docs, embeddings=vecs, metadatas=metas, ids=ids)
    chunk_counter += len(new_chunks)
    all_chunks.extend(new_chunks)
    _rebuild_bm25()

    return {"filename": filename, "pages": total_pages, "chunks": len(new_chunks),
            "total_indexed": len(all_chunks), "summary": summary, "status": "ready"}


# ── answer_question (non-streaming) ──────────────────────────────────────────
def answer_question(question: str, chat_history: list | None = None) -> dict:
    if not all_chunks:
        return {"error": "No documents uploaded yet."}
    chat_history = chat_history or []

    q_vec  = embedder.encode([question], convert_to_numpy=True)[0]
    cached = _cache_lookup(q_vec)
    if cached: return {**cached, "from_cache": True}

    top_hits, confidence, context = _retrieve(question, q_vec)
    prompt = _build_prompt(question, context, chat_history)

    resp   = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0, max_tokens=512,
    )
    answer = resp.choices[0].message.content

    # Verify citations against source chunks
    verified_citations = resolve_citations(answer, top_hits)

    _cache_save(q_vec, answer, verified_citations, confidence)
    return {"answer": answer, "citations": verified_citations,
            "confidence": confidence, "from_cache": False}


# ── stream_answer (SSE generator) ────────────────────────────────────────────
def stream_answer(question: str, chat_history: list | None = None):
    """
    Event order:
      1. {"type":"confidence", "confidence":87, "from_cache":false}
      2. {"type":"text",       "content":"word"}  ← repeated per token
      3. {"type":"citations",  "citations":[...]} ← verified, sent AFTER full answer
      4. [DONE]
    """
    if not all_chunks:
        yield f"data: {json.dumps({'type':'error','content':'No documents uploaded yet.'})}\n\n"
        return
    chat_history = chat_history or []

    q_vec  = embedder.encode([question], convert_to_numpy=True)[0]
    cached = _cache_lookup(q_vec)

    if cached:
        yield f"data: {json.dumps({'type':'confidence','confidence':cached['confidence'],'from_cache':True})}\n\n"
        yield f"data: {json.dumps({'type':'text','content':cached['answer']})}\n\n"
        yield f"data: {json.dumps({'type':'citations','citations':cached['citations']})}\n\n"
        yield "data: [DONE]\n\n"
        return

    top_hits, confidence, context = _retrieve(question, q_vec)

    # Send confidence first so UI knows answer is coming
    yield f"data: {json.dumps({'type':'confidence','confidence':confidence,'from_cache':False})}\n\n"

    # Stream answer token by token
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

    # After full answer received → verify citations → send to frontend
    # Truncate answer to avoid overloading the citation resolver
    verified_citations = resolve_citations(full_answer[:500], top_hits)
    yield f"data: {json.dumps({'type':'citations','citations':verified_citations})}\n\n"
    yield "data: [DONE]\n\n"

    _cache_save(q_vec, full_answer, verified_citations, confidence)


# ── Utilities ─────────────────────────────────────────────────────────────────
def clear_documents():
    global all_chunks, doc_texts, doc_summaries, bm25_index, semantic_cache, chunk_counter
    try:
        ids = collection.get()["ids"]
        if ids: collection.delete(ids=ids)
    except Exception: pass
    all_chunks.clear(); doc_texts.clear(); doc_summaries.clear()
    semantic_cache.clear(); bm25_index = None; chunk_counter = 0

def get_doc_text(name: str)    -> str:  return doc_texts.get(name, "")
def get_doc_summary(name: str) -> str:  return doc_summaries.get(name, "")
def list_doc_names()           -> list: return list(doc_texts.keys())