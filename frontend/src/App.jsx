import { useCallback, useEffect, useRef, useState } from "react"

// In Vercel, configure VITE_API_URL to the public Render backend URL.
const API = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "")

async function requestJson(path, options = {}) {
  const response = await fetch(`${API}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload.detail || payload.error || `Request failed (HTTP ${response.status})`
    throw new Error(message)
  }
  return payload
}

const post = (path, body) => requestJson(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
const get = path => requestJson(path)
const del_ = path => requestJson(path, { method: "DELETE" })

const S = {
  app: { display: "flex", height: "100vh", fontFamily: "system-ui,sans-serif", background: "#f9fafb", color: "#111827" },
  side: { width: 220, flexShrink: 0, background: "#fff", borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column", padding: 16, gap: 4 },
  logo: { fontSize: 16, fontWeight: 700, color: "#111827", padding: "8px 0 16px", display: "flex", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: "50%", background: "#2563eb" },
  nav: active => ({ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, textAlign: "left", width: "100%", background: active ? "#eff6ff" : "transparent", color: active ? "#2563eb" : "#6b7280" }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
  hdr: { padding: "14px 24px", borderBottom: "1px solid #e5e7eb", background: "#fff", fontSize: 15, fontWeight: 600 },
  body: { flex: 1, overflowY: "auto", padding: 24 },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 },
  lbl: { fontSize: 12, color: "#6b7280", marginBottom: 4, display: "block" },
  inp: { width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, outline: "none", boxSizing: "border-box" },
  btn: (variant = "primary") => ({ padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: variant === "primary" ? "#2563eb" : variant === "danger" ? "#dc2626" : "#f3f4f6", color: variant === "primary" || variant === "danger" ? "#fff" : "#374151" }),
  tag: (bg = "#eff6ff", color = "#2563eb") => ({ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: bg, color, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }),
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 20 },
  stat: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, textAlign: "center" },
  error: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 10, color: "#b91c1c", fontSize: 13, marginBottom: 12 },
}

const CITATION_STYLES = {
  verified: { bg: "#f0fdf4", color: "#15803d", icon: "✓" },
  partial: { bg: "#fefce8", color: "#854d0e", icon: "⚠" },
  incorrect: { bg: "#fef2f2", color: "#b91c1c", icon: "✗" },
  unrelated: { bg: "#f5f3ff", color: "#6d28d9", icon: "?" },
  unverified: { bg: "#f3f4f6", color: "#6b7280", icon: "~" },
}

function CitationTag({ citation }) {
  const style = CITATION_STYLES[citation.status] || CITATION_STYLES.unverified
  const tooltip = [
    `${citation.status?.toUpperCase() || "UNVERIFIED"} (${citation.confidence ?? "?"}% confident)`,
    citation.reason ? `Reason: ${citation.reason}` : "",
    citation.exact_quote ? `Quote: "${citation.exact_quote}"` : "",
  ].filter(Boolean).join("\n")
  return <span title={tooltip} style={{ ...S.tag(style.bg, style.color), cursor: "help", userSelect: "none" }}>
    <span>{style.icon}</span><span>{citation.doc || "Source"} · p.{citation.page ?? "?"}</span>
    {citation.confidence != null && <span style={{ opacity: 0.7 }}>· {citation.confidence}%</span>}
  </span>
}

async function uploadFile(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const form = new FormData()
    form.append("file", file)
    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100))
    })
    xhr.addEventListener("load", () => {
      let payload
      try { payload = JSON.parse(xhr.responseText || "{}") } catch { payload = {} }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (payload.error) reject(new Error(payload.error))
        else resolve(payload)
      } else {
        reject(new Error(payload.detail || payload.error || `Upload failed (HTTP ${xhr.status})`))
      }
    })
    xhr.addEventListener("error", () => reject(new Error("Upload connection failed. Please try again.")))
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out. Please try again.")))
    xhr.open("POST", `${API}/upload`)
    xhr.timeout = 120000
    xhr.send(form)
  })
}

function UploadBtn({ onDone, label = "+ Upload" }) {
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState("")

  async function handleChange(event) {
    const input = event.currentTarget
    const files = [...(input.files || [])]
    if (!files.length) return
    setError("")
    try {
      for (const file of files) {
        setProgress({ name: file.name, percent: 0 })
        const result = await uploadFile(file, percent => setProgress({ name: file.name, percent }))
        if (result.error) throw new Error(result.error)
      }
      if (onDone) await onDone()
    } catch (err) {
      setError(err.message || "Upload failed.")
      window.alert(err.message || "Upload failed.")
    } finally {
      setProgress(null)
      input.value = ""
    }
  }

  return <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
    <label style={{ position: "relative", ...S.btn("secondary"), cursor: "pointer", padding: "7px 14px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
      {progress ? `Uploading ${progress.percent}%` : label}
      {progress && <div style={{ position: "absolute", bottom: 0, left: 0, height: 3, width: `${progress.percent}%`, background: "#2563eb", transition: "width 0.15s" }} />}
      <input type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.txt" style={{ display: "none" }} onChange={handleChange} />
    </label>
    {error && <span style={{ color: "#b91c1c", fontSize: 11 }}>{error}</span>}
  </div>
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text || "")
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.alert("Clipboard access was blocked by your browser.")
    }
  }
  return <button onClick={copy} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, background: "#f3f4f6", border: "none", cursor: "pointer", color: "#374151" }}>{copied ? "✓ Copied" : "Copy"}</button>
}

function useDocuments() {
  const [docs, setDocs] = useState([])
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    try {
      const data = await get("/stats")
      setDocs(Array.isArray(data.documents) ? data.documents : [])
      setError("")
    } catch (err) {
      setError(err.message || "Could not load documents from the backend.")
    }
  }, [])
  useEffect(() => { reload() }, [reload])
  return { docs, reload, error, setError }
}

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState("")
  const load = useCallback(async () => {
    try {
      const data = await get("/stats")
      setStats({ documents: [], recent_questions: [], ...data })
      setError("")
    } catch (err) {
      setError(err.message || "Could not connect to the backend.")
    }
  }, [])
  useEffect(() => {
    load()
    const timer = window.setInterval(load, 10000)
    return () => window.clearInterval(timer)
  }, [load])

  if (!stats && !error) return <div style={S.body}>Loading dashboard…</div>
  if (error && !stats) return <div style={S.body}><div style={S.error}>{error}</div><button onClick={load} style={S.btn()}>Retry</button></div>

  const documents = stats.documents || []
  const iconFor = name => name?.endsWith(".pdf") ? "📕" : name?.endsWith(".docx") ? "📘" : name?.endsWith(".pptx") ? "📙" : name?.endsWith(".xlsx") ? "📗" : "📄"
  return <div style={S.body}>
    {error && <div style={S.error}>{error}</div>}
    <div style={S.grid}>
      {[["📄", "Documents", documents.length], ["💬", "Questions", stats.questions_asked ?? 0], ["⚖️", "Comparisons", stats.comparisons_done ?? 0], ["📊", "Reports", stats.reports_generated ?? 0]].map(([icon, label, value]) => <div key={label} style={S.stat}>
        <div style={{ fontSize: 26, marginBottom: 6 }}>{icon}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{label}</div>
      </div>)}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
      <div style={S.card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Uploaded documents</div>
        {!documents.length ? <div style={{ color: "#9ca3af", fontSize: 13 }}>No documents currently loaded. Upload one in Chat, Compare, or Reports.</div> : documents.map((doc, index) => <div key={`${doc.name}-${index}`} style={{ padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 18 }}>{iconFor(doc.name)}</span><div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500 }}>{doc.name}</div><div style={{ fontSize: 11, color: "#9ca3af" }}>{doc.pages} pages · {doc.chunks} chunks · {doc.uploaded_at}</div></div></div>
          {doc.summary && <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5, background: "#f9fafb", padding: "6px 10px", borderRadius: 6, margin: "6px 0 0 28px" }}>{doc.summary}</div>}
        </div>)}
        {documents.length > 0 && <button onClick={async () => { if (window.confirm("Clear all indexed documents?")) { try { await del_("/documents"); await load() } catch (err) { window.alert(err.message) } } }} style={{ ...S.btn("danger"), marginTop: 12, fontSize: 12 }}>Clear all</button>}
      </div>
      <div style={S.card}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recent questions</div>
        {!stats.recent_questions?.length ? <div style={{ color: "#9ca3af", fontSize: 13 }}>No questions yet</div> : [...stats.recent_questions].reverse().map((question, index) => <div key={`${question}-${index}`} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f3f4f6", color: "#374151" }}>💬 {question}</div>)}
      </div>
    </div>
  </div>
}

function ChatBubble({ message, streaming = false }) {
  const isAssistant = message.role === "assistant"
  const verifying = streaming && message.content && !message.citations?.length
  return <div style={{ display: "flex", flexDirection: "column", alignItems: isAssistant ? "flex-start" : "flex-end", width: "100%" }}>
    <div style={{ maxWidth: " min(85%, 800px)", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: isAssistant ? "#fff" : "#2563eb", color: isAssistant ? "#111827" : "#fff", border: isAssistant ? "1px solid #e5e7eb" : "none" }}>
      {message.content || (streaming ? "" : "")}
      {streaming && <span style={{ animation: "blink 0.8s step-end infinite", marginLeft: 2 }}>▌</span>}
    </div>
    {isAssistant && <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
      {(message.citations || []).map((citation, index) => <CitationTag key={`${citation.doc}-${citation.page}-${index}`} citation={citation} />)}
      {verifying && <span style={{ fontSize: 11, color: "#9ca3af" }}><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Verifying citations…</span>}
      {message.confidence !== undefined && <span style={{ ...S.tag(message.confidence >= 70 ? "#eff6ff" : message.confidence >= 40 ? "#fefce8" : "#fef2f2", message.confidence >= 70 ? "#1d4ed8" : message.confidence >= 40 ? "#854d0e" : "#b91c1c") }}>{message.confidence >= 70 ? "✓" : message.confidence >= 40 ? "~" : "?"} {message.confidence}% confident</span>}
      {message.from_cache && <span style={S.tag("#f5f3ff", "#6d28d9")}>⚡ from cache</span>}
      {message.content && !streaming && <CopyBtn text={message.content} />}
    </div>}
  </div>
}

function Chat() {
  const [messages, setMessages] = useState([])
  const [streamingMessage, setStreamingMessage] = useState(null)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const { docs, reload: reloadDocs } = useDocuments()
  const bottomRef = useRef(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages, streamingMessage])

  async function handleDrop(event) {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files].filter(file => [".pdf", ".docx", ".pptx", ".xlsx", ".txt"].some(ext => file.name.toLowerCase().endsWith(ext)))
    if (!files.length) return
    try {
      for (const file of files) await uploadFile(file)
      await reloadDocs()
      window.alert(`Uploaded ${files.length} file(s) successfully.`)
    } catch (err) {
      window.alert(err.message || "Upload failed.")
    }
  }

  function exportChat() {
    if (!messages.length) return window.alert("No chat to export yet.")
    const date = new Date().toISOString().slice(0, 10)
    const lines = messages.map(message => {
      const role = message.role === "user" ? "You" : "KnowledgeAI"
      const sources = (message.citations || []).map(citation => `${citation.doc} p.${citation.page} [${citation.status || ""}]`).join(", ")
      return `[${role}]\n${message.content}${sources ? `\nSources: ${sources}` : ""}`
    }).join(`\n\n${"─".repeat(40)}\n\n`)
    const blobUrl = URL.createObjectURL(new Blob([`KnowledgeAI Chat — ${date}\n${"═".repeat(40)}\n\n${lines}`], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = blobUrl
    link.download = `knowledgeai_chat_${date}.txt`
    link.click()
    URL.revokeObjectURL(blobUrl)
  }

  async function send() {
    const question = input.trim()
    if (!question || busy) return
    setInput("")
    const history = messages.map(message => ({ role: message.role, content: message.content }))
    setMessages(previous => [...previous, { role: "user", content: question }])
    setBusy(true)
    setStreamingMessage({ role: "assistant", content: "", citations: [], confidence: undefined, from_cache: false })

    let answerText = ""
    let citations = []
    let confidence
    let fromCache = false
    let sawErrorEvent = false

    const handleSseBlock = block => {
      const dataLines = block.split("\n").filter(line => line.startsWith("data:"))
      if (!dataLines.length) return false
      const raw = dataLines.map(line => line.slice(5).replace(/^ /, "")).join("\n")
      if (raw.trim() === "[DONE]") return true

      let event
      try {
        event = JSON.parse(raw)
      } catch (err) {
        console.warn("Ignoring malformed SSE event from KnowledgeAI.", err)
        return false
      }

      if (event.type === "confidence") {
        confidence = event.confidence
        fromCache = Boolean(event.from_cache)
        setStreamingMessage(previous => ({ ...(previous || {}), role: "assistant", confidence, from_cache: fromCache }))
      } else if (event.type === "text") {
        answerText += event.content || ""
        setStreamingMessage(previous => ({ ...(previous || {}), role: "assistant", content: answerText, citations, confidence, from_cache: fromCache }))
      } else if (event.type === "citations") {
        citations = Array.isArray(event.citations) ? event.citations : []
        setStreamingMessage(previous => ({ ...(previous || {}), role: "assistant", content: answerText, citations, confidence, from_cache: fromCache }))
      } else if (event.type === "error") {
        sawErrorEvent = true
        const errorText = `⚠️ ${event.content || "The AI service failed to respond. Please try again."}`
        answerText = answerText ? `${answerText}\n\n${errorText}` : errorText
        setStreamingMessage(previous => ({ ...(previous || {}), role: "assistant", content: answerText, citations, confidence, from_cache: fromCache }))
      }
      return false
    }

    try {
      const response = await fetch(`${API}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify({ question, chat_history: history }),
      })

      if (!response.ok) {
        const details = await response.text().catch(() => "")
        throw new Error(details || `Backend request failed (HTTP ${response.status}).`)
      }
      if (!response.body) throw new Error("The backend did not return a response stream.")

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let finished = false

      while (!finished) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
        buffer = buffer.replace(/\r\n/g, "\n")

        let boundary = -1
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (handleSseBlock(eventBlock)) {
            finished = true
            break
          }
        }

        if (done) {
          if (buffer.trim() && !finished) handleSseBlock(buffer)
          finished = true
        }
      }

      if (!answerText.trim()) {
        answerText = sawErrorEvent ? "⚠️ The AI service could not answer this question. Please try again." : "⚠️ No answer was received. Please try again."
      }
      setMessages(previous => [...previous, { role: "assistant", content: answerText, citations, confidence, from_cache: fromCache }])
    } catch (err) {
      console.error("KnowledgeAI chat request failed:", err)
      setMessages(previous => [...previous, { role: "assistant", content: `⚠️ ${err.message || "Connection error. Please try again."}`, citations: [] }])
    } finally {
      setStreamingMessage(null)
      setBusy(false)
    }
  }

  return <div style={{ ...S.main, height: "100%", position: "relative" }} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) }} onDrop={handleDrop}>
    {dragging && <div style={{ position: "absolute", inset: 0, background: "rgba(37,99,235,0.08)", border: "2px dashed #2563eb", zIndex: 10, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 600, color: "#2563eb" }}>Drop files to upload</div>}
    <div style={{ padding: "12px 24px", borderBottom: "1px solid #e5e7eb", background: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "#6b7280" }}>{docs.length === 0 ? "Drop files or upload to start" : "Docs:"}</span>
      {docs.slice(0, 3).map((doc, index) => <span key={`${doc.name}-${index}`} style={S.tag()}>{doc.name}</span>)}
      {docs.length > 3 && <span style={S.tag()}>+{docs.length - 3} more</span>}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {messages.length > 0 && <button onClick={exportChat} style={{ ...S.btn("secondary"), padding: "6px 12px", fontSize: 12 }}>⬇ Export chat</button>}
        <UploadBtn onDone={reloadDocs} />
      </div>
    </div>
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {!messages.length && !streamingMessage && <div style={{ margin: "auto", textAlign: "center", color: "#9ca3af" }}><div style={{ fontSize: 36, marginBottom: 8 }}>💬</div><div style={{ fontSize: 14 }}>Upload documents and ask anything</div><div style={{ fontSize: 12, marginTop: 4 }}>Citations are checked against retrieved source chunks.</div></div>}
      {messages.map((message, index) => <ChatBubble key={`${message.role}-${index}`} message={message} />)}
      {streamingMessage && <ChatBubble message={streamingMessage} streaming />}
      <div ref={bottomRef} />
    </div>
    <div style={{ padding: 16, borderTop: "1px solid #e5e7eb", background: "#fff", display: "flex", gap: 8 }}>
      <input value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send() } }} placeholder="Ask a question across all uploaded documents…" style={{ flex: 1, ...S.inp }} />
      <button onClick={send} disabled={busy || !input.trim()} style={{ ...S.btn(), opacity: busy || !input.trim() ? 0.6 : 1, cursor: busy || !input.trim() ? "not-allowed" : "pointer" }}>{busy ? "Thinking…" : "Ask"}</button>
    </div>
    <style>{`@keyframes blink {0%,100%{opacity:1} 50%{opacity:0}} @keyframes spin {from{transform:rotate(0deg)} to{transform:rotate(360deg)}}`}</style>
  </div>
}

function Compare() {
  const { docs, reload } = useDocuments()
  const [first, setFirst] = useState("")
  const [second, setSecond] = useState("")
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function runComparison() {
    if (!first || !second || first === second) return window.alert("Select two different documents.")
    setBusy(true); setError(""); setResult(null)
    try { setResult(await post("/compare", { doc1_name: first, doc2_name: second })) }
    catch (err) { setError(err.message || "Comparison failed.") }
    finally { setBusy(false) }
  }

  return <div style={S.body}>
    <div style={S.card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Select two documents to compare</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><UploadBtn onDone={reload} label="📎 Upload new file" />{docs.length > 0 && <span style={{ fontSize: 12, color: "#9ca3af" }}>{docs.length} file(s) available</span>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 14 }}>
        {[["Document 1", first, setFirst], ["Document 2", second, setSecond]].map(([label, value, setValue]) => <div key={label}><label style={S.lbl}>{label}</label><select value={value} onChange={event => setValue(event.target.value)} style={{ ...S.inp, background: "#fff" }}><option value="">— choose —</option>{docs.map((doc, index) => <option key={`${doc.name}-${index}`} value={doc.name}>{doc.name}</option>)}</select></div>)}
      </div>
      <button onClick={runComparison} disabled={busy || !first || !second || first === second} style={{ ...S.btn(), opacity: busy || !first || !second || first === second ? 0.6 : 1 }}>{busy ? "Comparing…" : "Compare documents"}</button>
      {!docs.length && <div style={{ marginTop: 10, fontSize: 12, color: "#9ca3af" }}>Upload two files to get started.</div>}
    </div>
    {error && <div style={S.error}>{error}</div>}
    {result?.error && <div style={S.error}>{result.error}</div>}
    {result?.comparison && <div style={S.card}><div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}><span style={S.tag()}>📄 {result.doc1 || first}</span><span style={{ color: "#9ca3af", alignSelf: "center" }}>vs</span><span style={S.tag()}>📄 {result.doc2 || second}</span></div><div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.7, color: "#374151" }}>{result.comparison}</div><div style={{ marginTop: 12 }}><CopyBtn text={result.comparison} /></div></div>}
  </div>
}

function Reports() {
  const { docs, reload } = useDocuments()
  const [docName, setDocName] = useState("")
  const [reportType, setReportType] = useState("summary")
  const [result, setResult] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function generateReport() {
    setBusy(true); setResult(null); setError("")
    try { setResult(await post("/report", { doc_name: docName || null, report_type: reportType })) }
    catch (err) { setError(err.message || "Report generation failed.") }
    finally { setBusy(false) }
  }

  return <div style={S.body}>
    <div style={S.card}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Generate AI report</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><UploadBtn onDone={reload} label="📎 Upload new file" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 14 }}>
        <div><label style={S.lbl}>Source (blank = all documents)</label><select value={docName} onChange={event => setDocName(event.target.value)} style={{ ...S.inp, background: "#fff" }}><option value="">All uploaded documents</option>{docs.map((doc, index) => <option key={`${doc.name}-${index}`} value={doc.name}>{doc.name}</option>)}</select></div>
        <div><label style={S.lbl}>Report type</label><select value={reportType} onChange={event => setReportType(event.target.value)} style={{ ...S.inp, background: "#fff" }}><option value="summary">Document summary</option><option value="executive">Executive summary</option><option value="meeting_minutes">Meeting minutes</option></select></div>
      </div>
      <button onClick={generateReport} disabled={busy} style={{ ...S.btn(), opacity: busy ? 0.6 : 1 }}>{busy ? "Generating…" : "Generate report"}</button>
    </div>
    {error && <div style={S.error}>{error}</div>}
    {result?.error && <div style={S.error}>{result.error}</div>}
    {result?.report && <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><span style={S.tag()}>📊 {(result.type || reportType).replaceAll("_", " ")}</span><span style={S.tag("#f0fdf4", "#15803d")}>📄 {result.source || docName || "All documents"}</span></div><div style={{ display: "flex", gap: 8 }}><CopyBtn text={result.report} />{result.pdf_filename && <a href={`${API}/report/download/${encodeURIComponent(result.pdf_filename)}`} target="_blank" rel="noreferrer" style={{ ...S.btn(), textDecoration: "none", fontSize: 12, display: "inline-block" }}>⬇ Download PDF</a>}</div></div>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap" }}>{result.report}</div>
    </div>}
  </div>
}

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "compare", label: "Compare", icon: "⚖️" },
  { id: "reports", label: "Reports", icon: "📋" },
]
const TITLES = { dashboard: "Dashboard", chat: "Document chat", compare: "Document comparison", reports: "Report generator" }

export default function App() {
  const [tab, setTab] = useState("dashboard")
  return <div style={S.app}>
    <div style={S.side}>
      <div style={S.logo}><div style={S.dot} />KnowledgeAI</div>
      {TABS.map(item => <button key={item.id} onClick={() => setTab(item.id)} style={S.nav(tab === item.id)}><span>{item.icon}</span>{item.label}</button>)}
      <div style={{ marginTop: "auto", fontSize: 11, color: "#d1d5db", lineHeight: 1.9 }}>Multi-doc RAG<br />Hybrid + multi-query<br />Citation verification<br />Streaming<br />Semantic cache<br />PDF reports</div>
    </div>
    <div style={S.main}>
      <div style={S.hdr}>{TITLES[tab]}</div>
      {tab === "dashboard" && <Dashboard />}
      {tab === "chat" && <Chat />}
      {tab === "compare" && <Compare />}
      {tab === "reports" && <Reports />}
    </div>
  </div>
}
