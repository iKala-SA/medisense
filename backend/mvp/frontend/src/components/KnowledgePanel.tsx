import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEPARTMENTS, DOC_CATEGORIES, type DocCategory, type KnowledgeDoc } from "../types";
import DocUploader from "./DocUploader";
import { ErrorBox, Icon, Modal, Spinner, fmtTime } from "./ui";

const catLabel = (c: DocCategory) => DOC_CATEGORIES.find((x) => x.id === c)?.label ?? c;

/** Studio left rail: attach hospital-library documents to this agent. Attaching edits the draft
 * (saved with 儲存草稿); the documents themselves live in 院內指引與醫學知識庫. */
export default function KnowledgePanel({ docIds, editable, department, onChange }: { docIds: string[]; editable: boolean; department: string; onChange: (ids: string[]) => void }) {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState("");
  const load = () => api.listDocs().then(setDocs).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  const byId = useMemo(() => new Map((docs ?? []).map((d) => [d.id, d])), [docs]);
  const attached = docIds.map((id) => byId.get(id)).filter((d): d is KnowledgeDoc => !!d);
  const missing = docs ? docIds.length - attached.length : 0;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="section-title text-sm"><Icon name="library_books" className="text-primary" />臨床知識庫與規範掛載</p>
        <span className="chip">{attached.length} 份已掛載</span>
      </div>
      <p className="mt-1 text-[11px] text-outline">來自全院「院內指引與醫學知識庫」· 只檢索掛載的文件 · 內容已去識別化</p>
      <div className="mt-3 space-y-2">
        {docs === null && <div className="grid place-items-center py-4"><Spinner /></div>}
        {attached.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-surface-container-low px-3 py-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-white text-primary"><Icon name={d.name.endsWith(".pdf") ? "picture_as_pdf" : "description"} /></span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold" title={d.name}>{d.name}</p>
              <p className="font-mono text-[10px] text-outline">{catLabel(d.category)} · v{d.version}{d.status !== "indexed" && <span className="text-error"> · {d.status === "error" ? "索引異常，檢索時略過" : "索引中"}</span>}</p>
            </div>
            {editable && <button className="btn-ghost px-1" title="卸載（文件仍保留在知識庫）" onClick={() => onChange(docIds.filter((x) => x !== d.id))}><Icon name="close" className="text-[16px]" /></button>}
          </div>
        ))}
        {missing > 0 && <p className="text-[11px] text-warning">{missing} 份掛載的文件已自知識庫刪除，檢索時會略過。</p>}
        {docs && attached.length === 0 && <p className="rounded-lg border border-dashed border-outline-variant px-3 py-4 text-center text-xs text-on-surface-variant">尚未掛載任何院內指引或規範文件</p>}
      </div>
      <ErrorBox msg={err} />
      {editable && <button className="btn-secondary mt-3 w-full" onClick={() => setPicking(true)}><Icon name="add_circle" className="text-[18px]" />從知識庫掛載文件</button>}
      {picking && docs && (
        <Picker docs={docs} initial={docIds.filter((id) => byId.has(id))} department={department} onClose={() => setPicking(false)}
          onUploaded={(d) => setDocs((cur) => [d, ...(cur ?? [])])}
          onDone={(ids) => { setPicking(false); onChange(ids); }} />
      )}
    </div>
  );
}

function Picker({ docs, initial, department, onClose, onUploaded, onDone }: {
  docs: KnowledgeDoc[]; initial: string[]; department: string; onClose: () => void; onUploaded: (d: KnowledgeDoc) => void; onDone: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<DocCategory | "">("");
  const [dept, setDept] = useState("");
  const [uploading, setUploading] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = docs.filter((d) => (!cat || d.category === cat) && (!dept || d.department === dept) && (!needle || d.name.toLowerCase().includes(needle)));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal wide title="從院內知識庫掛載文件" onClose={onClose}>
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr]">
        <div className="relative"><Icon name="search" className="absolute left-3 top-2.5 text-[20px] text-outline" />
          <input className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋文件名稱" /></div>
        <select value={cat} onChange={(e) => setCat(e.target.value as DocCategory | "")}><option value="">所有類別</option>{DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <select value={dept} onChange={(e) => setDept(e.target.value)}><option value="">全部科別</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
      </div>
      <div className="mt-3 max-h-[45vh] space-y-1.5 overflow-auto">
        {shown.map((d) => (
          <label key={d.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${sel.includes(d.id) ? "border-primary bg-primary-tint/40" : "border-hairline hover:bg-surface-container-low"}`}>
            <input type="checkbox" className="w-auto" checked={sel.includes(d.id)} onChange={() => toggle(d.id)} />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{d.name}</p>
              <p className="font-mono text-[10px] text-outline">{catLabel(d.category)} · {d.department || "未指定科別"} · v{d.version} · {fmtTime(d.updated_at ?? d.created_at)} · 已掛載 {d.agents.length} 個 Agent
                {d.status !== "indexed" && <span className="text-error"> · {d.status === "error" ? "索引異常" : "索引中"}</span>}</p>
            </div>
          </label>
        ))}
        {shown.length === 0 && <p className="py-6 text-center text-xs text-on-surface-variant">沒有符合條件的文件</p>}
      </div>
      <div className="mt-3">
        {uploading ? <DocUploader compact defaultDepartment={department} onUploaded={(d) => { onUploaded(d); setSel((s) => [...s, d.id]); }} />
          : <button className="btn-ghost text-xs" onClick={() => setUploading(true)}><Icon name="upload_file" className="text-[16px]" />找不到？上傳新文件至知識庫並掛載</button>}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
        <span className="text-xs text-on-surface-variant">已選 {sel.length} 份 · 確認後請「儲存草稿」生效</span>
        <div className="flex gap-2"><button className="btn-ghost" onClick={onClose}>取消</button><button className="btn-primary" onClick={() => onDone(sel)}>確認掛載</button></div>
      </div>
    </Modal>
  );
}
