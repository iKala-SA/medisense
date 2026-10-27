import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { DEPARTMENTS, DOC_CATEGORIES, type DocCategory, type KnowledgeDoc, type Role } from "../types";
import DocUploader from "../components/DocUploader";
import { Empty, ErrorBox, Icon, Modal, Spinner, fmtBytes, fmtTime } from "../components/ui";
import { currentUid } from "../mock";

const PAGE = 20;
const WEEK_MS = 7 * 86400e3;
const catLabel = (c: DocCategory) => DOC_CATEGORIES.find((x) => x.id === c)?.label ?? c;
const fileIcon = (name: string) => (name.endsWith(".pdf") ? "picture_as_pdf" : name.endsWith(".md") || name.endsWith(".json") || name.endsWith(".html") ? "code" : "description");
const ext = (name: string) => name.split(".").pop()?.toUpperCase() ?? "";

/** [PERSON_NAME]-style tokens highlighted, so reviewers can check what the inspect template caught. */
const Masked = ({ text }: { text: string }) => (
  <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-container-low p-4 font-mono text-xs leading-5">
    {text.split(/(\[[A-Z_]+\])/).map((part, i) => (/^\[[A-Z_]+\]$/.test(part) ? <mark key={i} className="rounded bg-warning-container px-0.5 text-warning">{part}</mark> : part))}
  </pre>
);

export default function Knowledge({ role }: { role: Role }) {
  const nav = useNavigate();
  const admin = role === "admin";
  const uid = currentUid();
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [tab, setTab] = useState<DocCategory | "all">("all");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ doc: KnowledgeDoc; text: string | null } | null>(null);
  const [editing, setEditing] = useState<KnowledgeDoc | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [focusUpload, setFocusUpload] = useState(0);
  const uploader = useRef<HTMLDivElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<KnowledgeDoc | null>(null);

  const load = () => api.listDocs().then(setDocs).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);
  useEffect(() => setPage(0), [tab, q, dept, agent, status]);

  const all = docs ?? [];
  const canEdit = (d: KnowledgeDoc) => admin || d.uploaded_uid === uid;
  const agentsInUse = useMemo(() => [...new Map(all.flatMap((d) => d.agents).map((a) => [a.id, a])).values()], [all]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((d) => (tab === "all" || d.category === tab) && (!dept || d.department === dept) && (!status || d.status === status)
      && (!agent || (agent === "none" ? d.agents.length === 0 : d.agents.some((a) => a.id === agent)))
      && (!needle || [d.name, d.department, d.uploaded_by, ...d.agents.map((a) => a.name)].some((s) => s.toLowerCase().includes(needle))));
  }, [all, tab, q, dept, agent, status]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));

  const act = async (id: string, f: () => Promise<unknown>) => {
    setBusy(id); setErr("");
    try { await f(); await load(); } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  };
  const openPreview = async (d: KnowledgeDoc) => {
    setPreview({ doc: d, text: null });
    try { const text = await api.previewDoc(d.id); setPreview({ doc: d, text }); } catch (e) { setPreview(null); setErr(String(e)); }
  };
  const remove = (d: KnowledgeDoc) => {
    const used = d.agents.length ? `\n\n目前掛載於 ${d.agents.length} 個 Agent（${d.agents.map((a) => a.name).join("、")}），刪除後將自動卸載。` : "";
    if (confirm(`刪除「${d.name}」？向量索引會一併移除，原檔仍保留於稽核儲存桶。${used}`)) act(d.id, () => api.deleteDoc(d.id));
  };
  const replace = (files: FileList | null) => {
    const d = replacing.current;
    if (d && files?.[0]) act(d.id, () => api.replaceDoc(d.id, files[0]));
  };
  /** One request per document: a single call could not re-index the whole library within Cloud Run's 300 s. */
  const reindexAll = async () => {
    const targets = all.filter((d) => d.status !== "indexing");
    if (!targets.length || !confirm(`以目前的 Sensitive Data Protection 檢查範本重新去識別化並重建 ${targets.length} 份文件的索引？過程中文件仍可使用。`)) return;
    const failed: string[] = [];
    setBatch({ done: 0, total: targets.length, failed });
    for (const [i, d] of targets.entries()) {
      try { await api.reindexDoc(d.id); } catch (e) { failed.push(`${d.name}：${String(e)}`); }
      setBatch({ done: i + 1, total: targets.length, failed: [...failed] });
    }
    await load();
  };

  const weekAgo = Date.now() - WEEK_MS;
  const tiles = [
    { label: "知識庫總文件數", value: all.length, unit: "份", sub: `本週新增 ${all.filter((d) => d.created_at && new Date(d.created_at).getTime() > weekAgo).length} 份`, icon: "library_books" },
    { label: "涵蓋科別", value: new Set(all.map((d) => d.department).filter(Boolean)).size, unit: "個科別", sub: `${new Set(all.map((d) => d.category)).size} 種文件類別`, icon: "domain" },
    { label: "已掛載 Agent", value: agentsInUse.length, unit: "個 Agent", sub: `${all.filter((d) => !d.agents.length).length} 份文件尚未被掛載`, icon: "smart_toy" },
    { label: "索引異常", value: all.filter((d) => d.status === "error").length, unit: "份", sub: all.some((d) => d.status === "error") ? "請上傳新版本或重新索引" : "全部文件索引正常", icon: "error", alert: all.some((d) => d.status === "error") },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <nav className="flex items-center gap-1 text-xs text-on-surface-variant">院區智能總覽<Icon name="chevron_right" className="text-[14px]" />治理與臨床指引<Icon name="chevron_right" className="text-[14px]" /><span className="font-semibold text-primary">院內指引與醫學知識庫</span></nav>
      <section className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold">院內指引與醫學知識庫
            <span className="chip"><Icon name="verified_user" className="text-[13px]" />索引前一律去識別化</span></h1>
          <p className="mt-1 font-mono text-[11px] text-outline">Vertex AI RAG Engine · 全院共用向量庫 · text-multilingual-embedding-002</p>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">集中管理全院各專科供 Agent 推論與 Grounding 檢索的指引、用藥手冊、護理 SOP 與法規。上傳一次即可掛載到多個 Agent；上傳新版本時，所有掛載的 Agent 會自動改用新版。</p>
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn-primary px-5 py-2.5" onClick={() => { uploader.current?.scrollIntoView({ behavior: "smooth", block: "center" }); setFocusUpload((n) => n + 1); }}><Icon name="add_circle" className="text-[18px]" />上傳臨床指引或文獻檔案</button>
          {admin && <button className="btn-secondary" disabled={!!batch && batch.done < batch.total} onClick={reindexAll}><Icon name="sync" className="text-[18px]" />批次重新索引 (Re-index)</button>}
        </div>
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`card flex items-center justify-between px-5 py-4 ${t.alert ? "border-error/40" : ""}`}>
            <div><p className="font-mono text-[10px] uppercase tracking-wider text-outline">{t.label}</p>
              <p className={`mt-1 text-3xl font-bold ${t.alert ? "text-error" : ""}`}>{docs ? t.value : "—"} <span className="text-sm font-medium text-on-surface-variant">{t.unit}</span></p>
              <p className={`text-xs ${t.alert ? "text-error" : "text-on-surface-variant"}`}>{t.sub}</p></div>
            <span className={`grid h-11 w-11 place-items-center rounded-lg ${t.alert ? "bg-error-container text-error" : "bg-primary-tint text-primary"}`}><Icon name={t.icon} /></span>
          </div>
        ))}
      </section>

      {batch && (
        <div className="card mt-4 px-5 py-3 text-sm">
          <div className="flex items-center gap-3">{batch.done < batch.total ? <Spinner /> : <Icon name="check_circle" className="text-primary" />}
            <span className="flex-1">批次重新索引：{batch.done} / {batch.total}{batch.failed.length ? `，${batch.failed.length} 份失敗` : ""}</span>
            {batch.done === batch.total && <button className="btn-ghost text-xs" onClick={() => setBatch(null)}>關閉</button>}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high"><div className="h-full bg-primary transition-all" style={{ width: `${(batch.done / batch.total) * 100}%` }} /></div>
          {batch.failed.map((f) => <p key={f} className="mt-1 text-xs text-error">{f}</p>)}
        </div>
      )}

      <div ref={uploader} className="card mt-5 p-4"><DocUploader focusSignal={focusUpload} onUploaded={() => load()} /></div>
      <div className="mt-3"><ErrorBox msg={err} /></div>

      <section className="card mt-5 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {[{ id: "all" as const, label: "全部知識文件" }, ...DOC_CATEGORIES].map((c) => (
            <button key={c.id} onClick={() => setTab(c.id)} className={`rounded-md px-3 py-1.5 text-xs ${tab === c.id ? "bg-primary-dark font-semibold text-white" : "text-on-surface-variant hover:bg-surface-container-low"}`}>
              {c.label} ({c.id === "all" ? all.length : all.filter((d) => d.category === c.id).length})</button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="relative"><Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
            <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋文件名稱、科別、上傳者或 Agent（例：急性冠心症、TTAS）" /></div>
          <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">全部專科科室</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">全部掛載 Agent</option><option value="none">尚未掛載</option>{agentsInUse.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">所有狀態</option><option value="indexed">已索引</option><option value="indexing">索引中</option><option value="error">索引異常</option></select>
        </div>
      </section>

      {docs === null ? <div className="grid place-items-center py-16"><Spinner /></div> : shown.length === 0 ? (
        <div className="mt-4"><Empty icon="menu_book" title={all.length ? "沒有符合條件的文件" : "知識庫尚無文件"} hint={all.length ? "調整分類或篩選條件。" : "從上方上傳第一份院內指引。"} /></div>
      ) : (
        <section className="card mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-hairline font-mono text-[10px] uppercase tracking-wider text-outline">
              <tr><th className="px-4 py-3 text-left">文件名稱與檔案格式</th><th className="px-3 py-3 text-left">所屬科別 / 上傳者</th><th className="px-3 py-3 text-left">掛載 Agent</th>
                <th className="px-3 py-3 text-left">版本 / 最後更新</th><th className="px-3 py-3 text-left">狀態</th><th className="px-4 py-3 text-right">操作</th></tr>
            </thead>
            <tbody>
              {shown.slice(page * PAGE, (page + 1) * PAGE).map((d) => (
                <tr key={d.id} className="border-t border-hairline align-top hover:bg-primary-tint/30">
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={fileIcon(d.name)} /></span>
                      <div className="min-w-0"><p className="font-semibold leading-snug">{d.name}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-outline"><span className="chip">{ext(d.name)} · {fmtBytes(d.size_bytes)}</span><span className="chip">{catLabel(d.category)}</span>{d.chars ? <span>{d.chars.toLocaleString()} 字已索引</span> : null}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-xs"><p className="font-semibold">{d.department || "未指定科別"}</p><p className="text-on-surface-variant">{d.uploaded_by.split("@")[0]}</p></td>
                  <td className="px-3 py-3"><div className="flex max-w-[220px] flex-wrap gap-1">
                    {d.agents.slice(0, 2).map((a) => <button key={a.id} className="chip hover:bg-primary-tint" onClick={() => nav(`/sandbox/${a.id}`)}>{a.name}</button>)}
                    {d.agents.length > 2 && <span className="chip" title={d.agents.slice(2).map((a) => a.name).join("、")}>+{d.agents.length - 2} Agent</span>}
                    {!d.agents.length && <span className="text-xs text-outline">尚未掛載</span>}</div></td>
                  <td className="px-3 py-3 text-xs"><p className="font-mono font-semibold">v{d.version}</p><p className="text-on-surface-variant">{fmtTime(d.updated_at ?? d.created_at)}</p></td>
                  <td className="px-3 py-3 text-xs">
                    {d.status === "indexed" ? <span className="flex items-center gap-1 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />已去識別化索引</span>
                      : d.status === "error" ? <span className="flex items-center gap-1 text-error" title={d.error}><span className="h-1.5 w-1.5 rounded-full bg-error" />索引異常</span>
                        : <span className="flex items-center gap-1 text-on-surface-variant"><Spinner className="h-3 w-3" />索引中</span>}
                    {d.status === "error" && <p className="mt-1 line-clamp-2 max-w-[180px] text-[10px] text-error">{d.error}</p>}
                  </td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-0.5">
                    {busy === d.id ? <Spinner /> : <>
                      <button className="btn-ghost px-1.5" title="預覽去識別化內容" disabled={d.status !== "indexed"} onClick={() => openPreview(d)}><Icon name="visibility" className="text-[18px]" /></button>
                      {canEdit(d) && <button className="btn-ghost px-1.5" title="上傳新版本（取代，掛載的 Agent 自動改用新版）" onClick={() => { replacing.current = d; replaceInput.current?.click(); }}><Icon name="upload" className="text-[18px]" /></button>}
                      {canEdit(d) && <button className="btn-ghost px-1.5" title="編輯分類與科別" onClick={() => setEditing(d)}><Icon name="edit" className="text-[18px]" /></button>}
                      {admin && <button className="btn-ghost px-1.5" title="以目前檢查範本重新索引" onClick={() => act(d.id, () => api.reindexDoc(d.id))}><Icon name="sync" className="text-[18px]" /></button>}
                      {canEdit(d) && <button className="btn-ghost px-1.5 text-error" title="刪除" onClick={() => remove(d)}><Icon name="delete" className="text-[18px]" /></button>}
                    </>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-on-surface-variant">
            <span>顯示第 {page * PAGE + 1} 至 {Math.min((page + 1) * PAGE, shown.length)} 筆，共 {shown.length} 份{shown.length !== all.length ? `（全院 ${all.length} 份）` : ""}</span>
            <div className="flex items-center gap-1">
              <button className="btn-ghost px-2 py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button>
              <span className="px-2 font-mono">{page + 1} / {pages}</span>
              <button className="btn-ghost px-2 py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>下一頁</button>
            </div>
          </div>
        </section>
      )}
      <input ref={replaceInput} type="file" hidden accept=".pdf,.txt,.md,.docx,.pptx,.html,.csv,.json" onChange={(e) => { replace(e.target.files); e.target.value = ""; }} />

      {preview && (
        <Modal wide title={`去識別化內容預覽：${preview.doc.name}`} onClose={() => setPreview(null)}>
          <p className="mb-3 text-xs text-on-surface-variant">這是 RAG Engine 實際收到的文字（v{preview.doc.version}）。標示處為 Sensitive Data Protection 依檢查範本替換的個資；若有遺漏，請調整範本後由管理員重新索引。</p>
          {preview.text === null ? <div className="grid place-items-center py-10"><Spinner /></div> : <Masked text={preview.text} />}
        </Modal>
      )}
      {editing && <EditDoc doc={editing} onClose={() => setEditing(null)} onSave={(c, dep) => { const d = editing; setEditing(null); act(d.id, () => api.updateDoc(d.id, c, dep)); }} />}
    </div>
  );
}

function EditDoc({ doc, onClose, onSave }: { doc: KnowledgeDoc; onClose: () => void; onSave: (c: DocCategory, dept: string) => void }) {
  const [category, setCategory] = useState(doc.category);
  const [department, setDepartment] = useState(doc.department);
  return (
    <Modal title="編輯分類與科別" onClose={onClose}>
      <p className="mb-3 text-sm font-semibold">{doc.name}</p>
      <label className="label">文件類別</label>
      <select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>{DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      <label className="label mt-3">所屬科別</label>
      <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="">未指定科別</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={onClose}>取消</button><button className="btn-primary" onClick={() => onSave(category, department)}>儲存</button></div>
    </Modal>
  );
}
