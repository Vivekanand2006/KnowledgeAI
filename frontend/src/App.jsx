import { useState, useRef, useEffect, useCallback } from "react"

const API = import.meta.env.VITE_API_URL || "http://localhost:8000"

const post = (url, body) =>
  fetch(API + url, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }).then(r => r.json())
const get  = (url) => fetch(API + url).then(r => r.json())
const del_ = (url) => fetch(API + url, { method:"DELETE" }).then(r => r.json())

// ── Style tokens ──────────────────────────────────────────────────────────────
const S = {
  app:  { display:"flex", height:"100vh", fontFamily:"system-ui,sans-serif", background:"#f9fafb", color:"#111827" },
  side: { width:220, background:"#fff", borderRight:"1px solid #e5e7eb", display:"flex", flexDirection:"column", padding:16, gap:4 },
  logo: { fontSize:16, fontWeight:700, color:"#111827", padding:"8px 0 16px", display:"flex", alignItems:"center", gap:8 },
  dot:  { width:8, height:8, borderRadius:"50%", background:"#2563eb" },
  nav:  (a) => ({ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:8,
                  border:"none", cursor:"pointer", fontSize:13, fontWeight:500, textAlign:"left", width:"100%",
                  background:a?"#eff6ff":"transparent", color:a?"#2563eb":"#6b7280" }),
  main: { flex:1, display:"flex", flexDirection:"column", overflow:"hidden" },
  hdr:  { padding:"14px 24px", borderBottom:"1px solid #e5e7eb", background:"#fff", fontSize:15, fontWeight:600 },
  body: { flex:1, overflowY:"auto", padding:24 },
  card: { background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:20, marginBottom:16 },
  lbl:  { fontSize:12, color:"#6b7280", marginBottom:4, display:"block" },
  inp:  { width:"100%", padding:"9px 12px", borderRadius:8, border:"1px solid #d1d5db", fontSize:13, outline:"none", boxSizing:"border-box" },
  btn:  (v="primary") => ({ padding:"9px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:500,
                             background:v==="primary"?"#2563eb":v==="danger"?"#dc2626":"#f3f4f6",
                             color:v==="primary"||v==="danger"?"#fff":"#374151" }),
  tag:  (bg="#eff6ff",c="#2563eb") => ({ fontSize:11, padding:"2px 8px", borderRadius:20, background:bg, color:c, fontWeight:500 }),
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:20 },
  stat: { background:"#fff", border:"1px solid #e5e7eb", borderRadius:10, padding:16, textAlign:"center" },
}

// ── Upload with progress bar ──────────────────────────────────────────────────
function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(), form = new FormData()
    form.append("file", file)
    xhr.upload.addEventListener("progress", e => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100))
    })
    xhr.addEventListener("load",  () => resolve(JSON.parse(xhr.responseText)))
    xhr.addEventListener("error", () => reject(new Error("Upload failed")))
    xhr.open("POST", `${API}/upload`); xhr.send(form)
  })
}

function UploadBtn({ onDone, label="+ Upload" }) {
  const [progress, setProgress] = useState(null)
  async function handle(e) {
    const files = [...e.target.files]; if (!files.length) return
    for (const f of files) { setProgress(0); await uploadWithProgress(f, setProgress) }
    setProgress(null); if (onDone) onDone(); e.target.value = ""
  }
  return (
    <label style={{ position:"relative", ...S.btn("secondary"), cursor:"pointer",
                    padding:"6px 14px", fontSize:12, display:"inline-flex",
                    alignItems:"center", gap:6, overflow:"hidden" }}>
      {progress !== null ? `Uploading ${progress}%` : label}
      {progress !== null &&
        <div style={{ position:"absolute", bottom:0, left:0, height:3,
                      width:`${progress}%`, background:"#2563eb", transition:"width 0.15s" }} />
      }
      <input type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.txt"
        style={{ display:"none" }} onChange={handle} />
    </label>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      style={{ fontSize:11, padding:"2px 8px", borderRadius:20, background:"#f3f4f6",
               border:"none", cursor:"pointer", color:"#374151" }}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const [d, setD] = useState(null)
  const load = () => get("/stats").then(setD)
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  if (!d) return <div style={{ padding:24, color:"#9ca3af" }}>Loading…</div>

  const docIcon = n => n.endsWith(".pdf")?"📕":n.endsWith(".docx")?"📘":n.endsWith(".pptx")?"📙":n.endsWith(".xlsx")?"📗":"📄"

  return (
    <div style={S.body}>
      <div style={S.grid}>
        {[["📄","Documents",d.documents?.length??0],["💬","Questions",d.questions_asked],
          ["⚖️","Comparisons",d.comparisons_done],["📊","Reports",d.reports_generated]].map(([icon,label,val])=>(
          <div key={label} style={S.stat}>
            <div style={{fontSize:26,marginBottom:6}}>{icon}</div>
            <div style={{fontSize:28,fontWeight:700}}>{val}</div>
            <div style={{fontSize:12,color:"#6b7280",marginTop:2}}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={S.card}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Uploaded documents</div>
          {d.documents.length===0
            ? <div style={{color:"#9ca3af",fontSize:13}}>No documents yet</div>
            : d.documents.map((doc,i)=>(
              <div key={i} style={{padding:"10px 0",borderBottom:"1px solid #f3f4f6"}}>
                <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:4}}>
                  <span style={{fontSize:18}}>{docIcon(doc.name)}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}}>{doc.name}</div>
                    <div style={{fontSize:11,color:"#9ca3af"}}>{doc.pages}p · {doc.chunks} chunks · {doc.uploaded_at}</div>
                  </div>
                </div>
                {/* Auto-generated summary */}
                {doc.summary && (
                  <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5,
                               background:"#f9fafb",padding:"6px 10px",borderRadius:6,marginLeft:28}}>
                    {doc.summary}
                  </div>
                )}
              </div>
            ))
          }
          {d.documents.length>0 &&
            <button onClick={async()=>{ if(confirm("Clear all?")){ await del_("/documents"); load() }}}
              style={{...S.btn("danger"),marginTop:12,fontSize:12}}>Clear all</button>
          }
        </div>
        <div style={S.card}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Recent questions</div>
          {d.recent_questions.length===0
            ? <div style={{color:"#9ca3af",fontSize:13}}>No questions yet</div>
            : [...d.recent_questions].reverse().map((q,i)=>(
              <div key={i} style={{fontSize:13,padding:"6px 0",borderBottom:"1px solid #f3f4f6",color:"#374151"}}>💬 {q}</div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function Chat() {
  const [msgs,         setMsgs]         = useState([])
  const [streamingMsg, setStreamingMsg] = useState(null)
  const [inp,          setInp]          = useState("")
  const [busy,         setBusy]         = useState(false)
  const [docs,         setDocs]         = useState([])
  const [dragging,     setDragging]     = useState(false)
  const end = useRef()

  const loadDocs = useCallback(() => get("/stats").then(d => setDocs(d.documents || [])), [])
  useEffect(() => { loadDocs() }, [])
  useEffect(() => { end.current?.scrollIntoView({ behavior:"smooth" }) }, [msgs, streamingMsg])

  // ── Drag and drop ────────────────────────────────────────────────────────
  async function handleDrop(e) {
    e.preventDefault(); setDragging(false)
    const files = [...e.dataTransfer.files].filter(f =>
      [".pdf",".docx",".pptx",".xlsx",".txt"].some(ext => f.name.toLowerCase().endsWith(ext))
    )
    for (const f of files) {
      const fm = new FormData(); fm.append("file", f)
      await fetch(`${API}/upload`, { method:"POST", body:fm })
    }
    if (files.length) loadDocs()
  }

  // ── Export chat ──────────────────────────────────────────────────────────
  function exportChat() {
    if (!msgs.length) return alert("No chat to export yet.")
    const date  = new Date().toISOString().slice(0,10)
    const lines = msgs.map(m => {
      const role    = m.role==="user" ? "You" : "KnowledgeAI"
      const sources = m.citations?.map(c=>`${c.doc} p.${c.page}`).join(", ")
      return `[${role}]\n${m.content}${sources?`\n📎 Sources: ${sources}`:""}`
    }).join(`\n\n${"─".repeat(40)}\n\n`)
    const blob = new Blob([`KnowledgeAI Chat — ${date}\n${"═".repeat(40)}\n\n${lines}`], {type:"text/plain"})
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement("a"), {href:url, download:`chat_${date}.txt`})
    a.click(); URL.revokeObjectURL(url)
  }

  // ── Streaming send ────────────────────────────────────────────────────────
  async function send() {
    const q = inp.trim(); if (!q || busy) return
    setInp("")
    const history = msgs.map(m => ({role:m.role, content:m.content}))
    setMsgs(p => [...p, {role:"user", content:q}])
    setBusy(true)
    setStreamingMsg({content:"", citations:[], confidence:undefined, from_cache:false})

    try {
      const res     = await fetch(`${API}/ask/stream`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({question:q, chat_history:history}),
      })
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let streamed  = "", citations=[], confidence=undefined, from_cache=false

      while (true) {
        const {done, value} = await reader.read(); if (done) break
        const lines = decoder.decode(value,{stream:true}).split("\n").filter(l=>l.startsWith("data: "))
        for (const line of lines) {
          const raw = line.slice(6); if (raw==="[DONE]") break
          try {
            const data = JSON.parse(raw)
            if (data.type==="meta") {
              citations=data.citations||[]; confidence=data.confidence; from_cache=data.from_cache
              setStreamingMsg(p=>({...p, citations, confidence, from_cache}))
            } else if (data.type==="text") {
              streamed += data.content
              setStreamingMsg(p=>({...p, content:streamed}))
            } else if (data.type==="error") {
              streamed = "⚠️ "+data.content
              setStreamingMsg(p=>({...p, content:streamed}))
            }
          } catch(_) {}
        }
      }
      setMsgs(p=>[...p,{role:"assistant",content:streamed,citations,confidence,from_cache}])
    } catch(err) {
      setMsgs(p=>[...p,{role:"assistant",content:"⚠️ Connection error. Please try again.",citations:[]}])
    }
    setStreamingMsg(null); setBusy(false)
  }

  // ── Message bubble ────────────────────────────────────────────────────────
  function Bubble({m, streaming=false}) {
    const isAI = m.role==="assistant"
    return (
      <div style={{display:"flex",flexDirection:"column",alignItems:isAI?"flex-start":"flex-end"}}>
        <div style={{maxWidth:"72%",padding:"10px 14px",borderRadius:12,fontSize:13,
                     lineHeight:1.7,whiteSpace:"pre-wrap",
                     background:isAI?"#fff":"#2563eb",
                     color:isAI?"#111827":"#fff",
                     border:isAI?"1px solid #e5e7eb":"none"}}>
          {m.content}
          {streaming&&<span style={{animation:"blink 0.8s step-end infinite",marginLeft:2}}>▌</span>}
        </div>
        {isAI&&(
          <div style={{display:"flex",gap:6,marginTop:5,flexWrap:"wrap",alignItems:"center"}}>
            {/* Page citations */}
            {m.citations?.map((c,j)=>(
              <span key={j} style={S.tag("#f0fdf4","#15803d")}>📎 {c.doc} · p.{c.page}</span>
            ))}
            {/* Confidence badge */}
            {m.confidence!==undefined&&(
              <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,fontWeight:500,
                            background:m.confidence>=70?"#eff6ff":m.confidence>=40?"#fefce8":"#fef2f2",
                            color:m.confidence>=70?"#1d4ed8":m.confidence>=40?"#854d0e":"#b91c1c"}}>
                {m.confidence>=70?"✓":m.confidence>=40?"~":"?"} {m.confidence}% confident
              </span>
            )}
            {/* Cache badge */}
            {m.from_cache&&<span style={S.tag("#f5f3ff","#6d28d9")}>⚡ from cache</span>}
            {/* Copy button */}
            {m.content&&!streaming&&<CopyBtn text={m.content}/>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{...S.main,height:"100%",position:"relative"}}
         onDragOver={e=>{e.preventDefault();setDragging(true)}}
         onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false)}}
         onDrop={handleDrop}>

      {/* Drag overlay */}
      {dragging&&(
        <div style={{position:"absolute",inset:0,background:"rgba(37,99,235,0.08)",
                     border:"2px dashed #2563eb",borderRadius:0,zIndex:10,pointerEvents:"none",
                     display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,
                     fontWeight:600,color:"#2563eb"}}>
          Drop files to upload
        </div>
      )}

      {/* Top bar */}
      <div style={{padding:"12px 24px",borderBottom:"1px solid #e5e7eb",background:"#fff",
                   display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:13,color:"#6b7280"}}>
          {docs.length===0?"Drop files or upload to start":"Docs:"}
        </span>
        {docs.slice(0,3).map((d,i)=><span key={i} style={S.tag()}>{d.name}</span>)}
        {docs.length>3&&<span style={S.tag()}>+{docs.length-3} more</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {msgs.length>0&&(
            <button onClick={exportChat} style={{...S.btn("secondary"),padding:"6px 12px",fontSize:12}}>
              ⬇ Export chat
            </button>
          )}
          <UploadBtn onDone={loadDocs}/>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1,overflowY:"auto",padding:24,display:"flex",flexDirection:"column",gap:16}}>
        {msgs.length===0&&!streamingMsg&&(
          <div style={{margin:"auto",textAlign:"center",color:"#9ca3af"}}>
            <div style={{fontSize:36,marginBottom:8}}>💬</div>
            <div style={{fontSize:14}}>Upload documents and ask anything</div>
            <div style={{fontSize:12,marginTop:4,color:"#d1d5db"}}>
              You can also drag and drop files anywhere on this page
            </div>
          </div>
        )}
        {msgs.map((m,i)=><Bubble key={i} m={m}/>)}
        {streamingMsg&&<Bubble m={{...streamingMsg,role:"assistant"}} streaming/>}
        <div ref={end}/>
      </div>

      {/* Input */}
      <div style={{padding:16,borderTop:"1px solid #e5e7eb",background:"#fff",display:"flex",gap:8}}>
        <input value={inp} onChange={e=>setInp(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="Ask a question across all uploaded documents…"
          style={{flex:1,...S.inp}}/>
        <button onClick={send} disabled={busy} style={S.btn()}>Ask</button>
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  )
}

// ── Compare ───────────────────────────────────────────────────────────────────
function Compare() {
  const [docs,setDocs]     = useState([])
  const [d1,setD1]         = useState("")
  const [d2,setD2]         = useState("")
  const [result,setResult] = useState(null)
  const [busy,setBusy]     = useState(false)
  const loadDocs = () => get("/stats").then(d=>setDocs(d.documents||[]))
  useEffect(()=>{loadDocs()},[])

  async function run() {
    if(!d1||!d2||d1===d2) return alert("Select two different documents")
    setBusy(true); setResult(null)
    setResult(await post("/compare",{doc1_name:d1,doc2_name:d2}))
    setBusy(false)
  }

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Select two documents to compare</div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <UploadBtn onDone={loadDocs} label="📎 Upload new file"/>
          {docs.length>0&&<span style={{fontSize:12,color:"#9ca3af"}}>{docs.length} file{docs.length>1?"s":""} available</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          {[["Document 1",d1,setD1],["Document 2",d2,setD2]].map(([lbl,val,set])=>(
            <div key={lbl}>
              <label style={S.lbl}>{lbl}</label>
              <select value={val} onChange={e=>set(e.target.value)} style={{...S.inp,background:"#fff"}}>
                <option value="">— choose —</option>
                {docs.map((d,i)=><option key={i} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button onClick={run} disabled={busy||!d1||!d2}
          style={{...S.btn(),opacity:(!d1||!d2)?0.5:1,cursor:(!d1||!d2)?"not-allowed":"pointer"}}>
          {busy?"Comparing…":"Compare documents"}
        </button>
        {docs.length===0&&<div style={{marginTop:10,fontSize:12,color:"#9ca3af"}}>Upload two files above to get started.</div>}
      </div>

      {result?.error&&<div style={{...S.card,background:"#fef2f2",borderColor:"#fca5a5",color:"#b91c1c",fontSize:13}}>{result.error}</div>}
      {result?.comparison&&(
        <div style={S.card}>
          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <span style={S.tag()}>📄 {result.doc1}</span>
            <span style={{color:"#9ca3af",alignSelf:"center"}}>vs</span>
            <span style={S.tag()}>📄 {result.doc2}</span>
          </div>
          {result.comparison.split(/\n(?=[A-Z ]+:)/).map((sec,i)=>{
            const [head,...rest]=sec.split("\n")
            return (
              <div key={i} style={{marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#1d4ed8",marginBottom:4}}>{head}</div>
                <div style={{fontSize:13,lineHeight:1.7,color:"#374151",whiteSpace:"pre-wrap"}}>{rest.join("\n")}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Reports ───────────────────────────────────────────────────────────────────
function Reports() {
  const [docs,setDocs]     = useState([])
  const [docName,setDoc]   = useState("")
  const [rtype,setRtype]   = useState("summary")
  const [result,setResult] = useState(null)
  const [busy,setBusy]     = useState(false)
  const loadDocs = () => get("/stats").then(d=>setDocs(d.documents||[]))
  useEffect(()=>{loadDocs()},[])

  return (
    <div style={S.body}>
      <div style={S.card}>
        <div style={{fontSize:14,fontWeight:600,marginBottom:14}}>Generate AI report</div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <UploadBtn onDone={loadDocs} label="📎 Upload new file"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <label style={S.lbl}>Source (blank = all docs)</label>
            <select value={docName} onChange={e=>setDoc(e.target.value)} style={{...S.inp,background:"#fff"}}>
              <option value="">All uploaded documents</option>
              {docs.map((d,i)=><option key={i} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label style={S.lbl}>Report type</label>
            <select value={rtype} onChange={e=>setRtype(e.target.value)} style={{...S.inp,background:"#fff"}}>
              <option value="summary">Document summary</option>
              <option value="executive">Executive summary</option>
              <option value="meeting_minutes">Meeting minutes</option>
            </select>
          </div>
        </div>
        <button onClick={async()=>{setBusy(true);setResult(null);setResult(await post("/report",{doc_name:docName||null,report_type:rtype}));setBusy(false)}}
          disabled={busy} style={S.btn()}>{busy?"Generating…":"Generate report"}</button>
      </div>

      {result?.error&&<div style={{...S.card,background:"#fef2f2",borderColor:"#fca5a5",color:"#b91c1c",fontSize:13}}>{result.error}</div>}
      {result?.report&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:8}}>
              <span style={S.tag()}>📊 {result.type?.replace("_"," ")}</span>
              <span style={S.tag("#f0fdf4","#15803d")}>📄 {result.source}</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <CopyBtn text={result.report}/>
              {result.pdf_filename&&(
                <a href={`${API}/report/download/${result.pdf_filename}`} target="_blank" rel="noreferrer"
                  style={{...S.btn(),textDecoration:"none",fontSize:12,display:"inline-block"}}>⬇ Download PDF</a>
              )}
            </div>
          </div>
          <div style={{fontSize:13,lineHeight:1.8,color:"#374151",whiteSpace:"pre-wrap"}}>{result.report}</div>
        </div>
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
const TABS   = [{id:"dashboard",label:"Dashboard",icon:"📊"},{id:"chat",label:"Chat",icon:"💬"},
                {id:"compare",label:"Compare",icon:"⚖️"},{id:"reports",label:"Reports",icon:"📋"}]
const TITLES = {dashboard:"Dashboard",chat:"Document chat",compare:"Document comparison",reports:"Report generator"}

export default function App() {
  const [tab,setTab] = useState("dashboard")
  return (
    <div style={S.app}>
      <div style={S.side}>
        <div style={S.logo}><div style={S.dot}/>KnowledgeAI</div>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={S.nav(tab===t.id)}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
        <div style={{marginTop:"auto",fontSize:11,color:"#d1d5db",lineHeight:1.9}}>
          Multi-doc RAG<br/>Semantic chunking<br/>Hybrid search<br/>Multi-query<br/>
          Page citations<br/>Streaming<br/>Semantic cache<br/>PDF reports
        </div>
      </div>
      <div style={S.main}>
        <div style={S.hdr}>{TITLES[tab]}</div>
        {tab==="dashboard"&&<Dashboard/>}
        {tab==="chat"     &&<Chat/>}
        {tab==="compare"  &&<Compare/>}
        {tab==="reports"  &&<Reports/>}
      </div>
    </div>
  )
}
