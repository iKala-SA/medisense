import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DEPARTMENTS, DOC_CATEGORIES, type DocCategory, type KnowledgeDoc } from "../types";
import { ErrorBox, Icon, Spinner } from "./ui";

const ACCEPT = ".pdf,.txt,.md,.docx,.pptx,.html,.csv,.json";

/** Drop zone for the hospital knowledge library. Category is required; files upload one at a time
 * because each is de-identified and indexed synchronously by the backend. */
export default function DocUploader({ defaultDepartment = "", onUploaded, compact = false, focusSignal = 0 }: {
  defaultDepartment?: string; onUploaded: (d: KnowledgeDoc) => void; compact?: boolean;
  /** Bump to focus the category picker and flash the zone (the page's header upload button). */
  focusSignal?: number;
}) {
  const [category, setCategory] = useState<DocCategory | "">("");
  const [department, setDepartment] = useState(defaultDepartment);
  const [busy, setBusy] = useState("");
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const [needCategory, setNeedCategory] = useState(false);
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);

  const askCategory = () => { setNeedCategory(true); categoryRef.current?.focus(); };
  useEffect(() => {
    if (!focusSignal) return;
    categoryRef.current?.focus({ preventScroll: true });
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(t);
  }, [focusSignal]);
  /** The button is never disabled for a missing category: a silent disabled button looked broken. */
  const choose = () => (category ? input.current?.click() : askCategory());

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!category) { askCategory(); return; }
    setErr("");
    for (const f of Array.from(list)) {
      setBusy(f.name);
      try { onUploaded(await api.uploadDoc(f, category, department)); } catch (e) { setErr(`${f.name}: ${String(e)}`); }
    }
    setBusy("");
  };

  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
      className={`rounded-xl border-2 border-dashed px-5 ${compact ? "py-4" : "py-6"} transition-colors ${over || flash ? "border-primary bg-primary-tint/50" : "border-outline-variant bg-surface-container-low"}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-tint text-primary"><Icon name="cloud_upload" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">拖曳臨床文獻檔案至此或點擊選擇</p>
          <p className="mt-1 text-xs leading-5 text-on-surface-variant">支援 PDF、DOCX、PPTX、TXT、Markdown、HTML、CSV、JSON，單檔上限 25 MB。上傳後自動執行：
            <span className="text-primary"> Sensitive Data Protection 去識別化 → 文字擷取與分塊 → Vertex AI 向量嵌入 (text-multilingual-embedding-002)</span>。原檔保留於 CMEK 加密儲存桶。</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select ref={categoryRef} className={`w-auto py-1.5 text-sm ${needCategory && !category ? "border-error ring-2 ring-error/30" : ""}`} value={category}
          onChange={(e) => { setCategory(e.target.value as DocCategory); setNeedCategory(false); }}>
          <option value="">選擇文件類別（必填）</option>{DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className="w-auto py-1.5 text-sm" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">所屬科別（選填）</option>{DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="flex-1" />
        <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <button className="btn-primary" disabled={!!busy} onClick={choose}>
          {busy ? <Spinner /> : <Icon name="upload_file" className="text-[18px]" />}選擇本機文獻檔案</button>
      </div>
      {needCategory && !category && <p className="mt-2 flex items-center gap-1 text-xs text-error"><Icon name="error" className="text-[14px]" />請先選擇文件類別，再選擇檔案。</p>}
      {busy && <p className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant"><Spinner />去識別化並建立索引中：{busy}（大型檔案約需 30 秒以上）</p>}
      <div className="mt-2"><ErrorBox msg={err} /></div>
    </div>
  );
}
