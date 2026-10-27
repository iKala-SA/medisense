import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { ConnectorIn, ConnectorOut, ConnectorType, FieldSpec, TestResult } from "../types";
import { ErrorBox, Field, Icon, Spinner } from "../components/ui";
import { currentUid } from "../mock";
import { statusPill } from "./Connectors";

const Section = ({ n, title, children, right }: { n: string; title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="card p-6">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-bold"><span className="h-5 w-1 rounded bg-primary" />{title}</h2>
      {right ?? <span className="mono">SECTION {n} / 04</span>}
    </div>
    {children}
  </section>
);

export default function ConnectorSetup() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const isNew = !id;
  const [types, setTypes] = useState<ConnectorType[]>([]);
  const [typeId, setTypeId] = useState(sp.get("type") ?? "mcp");
  const [existing, setExisting] = useState<ConnectorOut | null>(null);
  const [form, setForm] = useState<ConnectorIn>({ type: typeId, label: "", scope: "", config: {}, secrets: {}, redact_pii: true, audit_payloads: true });
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"" | "save" | "test" | "delete">("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => { api.connectorTypes().then((t) => setTypes(t.types)).catch((e) => setErr(String(e))); }, []);
  useEffect(() => {
    if (!id) return;
    api.getConnector(id).then((c) => {
      setExisting(c); setTypeId(c.type); setTest(c.last_test ?? null);
      setForm({ type: c.type, label: c.label, scope: c.scope, config: c.config, secrets: {}, redact_pii: c.redact_pii, audit_payloads: c.audit_payloads });
    }).catch((e) => setErr(String(e)));
  }, [id]);

  const spec = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  // Apply spec defaults for a new connector once the spec is known.
  useEffect(() => {
    if (!spec || !isNew) return;
    const cfg: Record<string, unknown> = {};
    for (const f of spec.fields) if (f.kind !== "secret" && f.default != null) cfg[f.key] = f.default;
    setForm((x) => ({ ...x, type: spec.id, label: x.label || spec.label, config: { ...cfg, ...x.config } }));
  }, [spec, isNew]);

  const editable = isNew || (existing != null && existing.owner_uid === currentUid());
  const setCfg = (k: string, v: unknown) => setForm((x) => ({ ...x, config: { ...x.config, [k]: v } }));
  const setSecret = (k: string, v: string) => setForm((x) => ({ ...x, secrets: { ...x.secrets, [k]: v } }));

  const save = async (): Promise<ConnectorOut | null> => {
    if (!spec) return null;
    setBusy("save"); setErr("");
    try {
      const missing = spec.fields.filter((f) => f.required && (f.kind === "secret" ? !(form.secrets[f.key] || existing?.secret_fields.includes(f.key)) : !form.config[f.key]));
      if (!form.label.trim()) throw new Error("請填寫連接器識別名稱");
      if (missing.length) throw new Error(`必填欄位：${missing.map((f) => f.label).join("、")}`);
      const c = isNew ? await api.createConnector(form) : await api.updateConnector(id!, form);
      setExisting(c); setForm((x) => ({ ...x, secrets: {} })); setSaved(new Date().toLocaleTimeString("zh-TW"));
      if (isNew) nav(`/connectors/${c.id}`, { replace: true });
      return c;
    } catch (e) { setErr(String(e)); return null; } finally { setBusy(""); }
  };
  const runTest = async () => {
    const c = existing && !Object.values(form.secrets).some(Boolean) ? existing : await save();
    if (!c) return;
    setBusy("test"); setErr("");
    try { const r = await api.testConnector(c.id); setTest(r); setExisting((x) => (x ? { ...x, status: r.ok ? "active" : "error", last_test: r } : x)); }
    catch (e) { setErr(String(e)); } finally { setBusy(""); }
  };
  const remove = async () => {
    if (!existing || !confirm(`刪除「${existing.label}」？Secret Manager 中的憑證將一併刪除。`)) return;
    setBusy("delete");
    try { await api.deleteConnector(existing.id); nav("/connectors"); } catch (e) { setErr(String(e)); setBusy(""); }
  };

  if (!spec) return <div className="grid h-full place-items-center">{err ? <ErrorBox msg={err} /> : <Spinner />}</div>;

  const renderField = (f: FieldSpec) => {
    const isSecret = f.kind === "secret";
    const hasStored = isSecret && existing?.secret_fields.includes(f.key);
    const label = <>{f.label}{f.required && <span className="ml-1 text-error">*</span>}</>;
    const right = isSecret ? <span className="chip"><Icon name="lock" className="text-[12px]" />{hasStored ? "已加密保存 · 留空保留" : "AES-256 · Secret Manager"}</span> : undefined;
    if (f.kind === "select") return (
      <Field key={f.key} label="" hint={f.hint} right={right}><span className="label -mt-0">{label}</span>
        <select value={String(form.config[f.key] ?? f.default ?? "")} onChange={(e) => setCfg(f.key, e.target.value)} disabled={!editable}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>);
    if (f.kind === "checkboxes") {
      const sel = (form.config[f.key] as string[] | undefined) ?? (f.default as string[] | undefined) ?? [];
      return (
        <div key={f.key}><div className="flex items-end justify-between"><span className="label">{label}</span><span className="mono">依最小權限原則 (Least Privilege) 授予</span></div>
          <div className="grid gap-2 md:grid-cols-2">{f.options.map((o) => (
            <label key={o.value} className={`flex items-start gap-2 rounded-lg border border-hairline px-3 py-2 text-xs ${o.disabled ? "opacity-50" : "cursor-pointer hover:bg-primary-tint/40"}`}>
              <input type="checkbox" className="mt-0.5 w-auto" checked={sel.includes(o.value)} disabled={!editable || o.disabled}
                onChange={(e) => setCfg(f.key, e.target.checked ? [...sel, o.value] : sel.filter((x) => x !== o.value))} />
              <span className="font-mono">{o.label}</span></label>))}</div>
          {f.hint && <p className="mt-1 text-[11px] text-outline">{f.hint}</p>}</div>);
    }
    if (f.kind === "textarea") return (
      <Field key={f.key} label="" hint={f.hint} right={right}><span className="label -mt-0">{label}</span>
        <textarea rows={3} className="font-mono text-xs" value={String(form.config[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => setCfg(f.key, e.target.value)} disabled={!editable} /></Field>);
    return (
      <Field key={f.key} label="" hint={f.hint} right={right}><span className="label -mt-0">{label}</span>
        <div className="relative">
          <input type={isSecret && !reveal[f.key] ? "password" : "text"} className={isSecret ? "pr-10 font-mono" : "font-mono"} value={isSecret ? form.secrets[f.key] ?? "" : String(form.config[f.key] ?? "")}
            placeholder={isSecret && hasStored ? "••••••••••••••（已保存，輸入新值可覆寫）" : f.placeholder} disabled={!editable}
            onChange={(e) => (isSecret ? setSecret(f.key, e.target.value) : setCfg(f.key, e.target.value))} />
          {isSecret && <button type="button" className="absolute right-2 top-1.5 text-outline" onClick={() => setReveal((r) => ({ ...r, [f.key]: !r[f.key] }))}><Icon name={reveal[f.key] ? "visibility_off" : "visibility"} className="text-[18px]" /></button>}
        </div></Field>);
  };
  const serverFields = spec.fields.filter((f) => f.section === "server");
  const credFields = spec.fields.filter((f) => f.section === "credentials");

  return (
    <div className="flex h-full flex-col">
      <section className="flex shrink-0 flex-wrap items-center gap-4 border-b border-hairline bg-white px-5 py-3">
        <button className="btn-ghost px-2" onClick={() => nav("/connectors")}><Icon name="arrow_back" /></button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-mono text-[11px] text-outline">返回連接器目錄 / Connectors 連接器 / {spec.label}{isNew ? "（設定中）" : ""}</p>
          <p className="flex flex-wrap items-center gap-2 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name={spec.icon} className="text-[18px]" /></span>{form.label || spec.label}
            <span className="chip">{spec.protocol}</span>{existing && statusPill(existing.status)}{test && <span className="mono">連線狀態：{test.ok ? "正常" : "失敗"} (Ping {test.ms}ms)</span>}</p>
        </div>
        {editable && spec.available && <button className="btn-secondary" onClick={runTest} disabled={!!busy}>{busy === "test" ? <Spinner /> : <Icon name="sensors" className="text-[18px]" />}測試端點連線 {spec.id === "mcp" ? "(Ping MCP)" : ""}</button>}
        {editable && <button className="btn-primary" onClick={save} disabled={!!busy}>{busy === "save" ? <Spinner /> : <Icon name="task_alt" className="text-[18px]" />}儲存設定</button>}
      </section>
      {!spec.available && <div className="flex items-center gap-2 bg-warning-container px-5 py-1.5 text-xs text-warning"><Icon name="schedule" className="text-[16px]" />{spec.coming}　設定可先儲存，但目前無法測試或由 Agent 呼叫。</div>}
      {!editable && existing && <div className="bg-warning-container px-5 py-1.5 text-xs text-warning">此連接器由 {existing.owner_email} 建立，您可在 Agent 中使用，但不能修改憑證。</div>}

      <div className="mx-auto w-full max-w-5xl space-y-4 px-5 py-5">
        <ErrorBox msg={err} />
        <section className="card p-6">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-tint text-primary"><Icon name="verified_user" /></span>
          <p className="mt-3 flex items-center gap-2 text-base font-bold">符合臺中榮總醫療資訊安全標準 (TCVGH Clinical AI Guardrail) <span className="chip">Secret Manager · 稽核日誌</span></p>
          <p className="mt-1 text-sm text-on-surface-variant">憑證以 Secret Manager 加密保存，瀏覽器儲存後不再取回。工具節點送出的參數可先經 Sensitive Data Protection 去識別化，所有呼叫寫入稽核集合。</p>
        </section>

        <Section n="01" title="基本資訊 (Basic Settings)">
          {isNew && (
            <Field label="連接器類型"><select value={typeId} onChange={(e) => { setTypeId(e.target.value); setForm((x) => ({ ...x, type: e.target.value, config: {}, secrets: {}, label: "" })); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}{t.available ? "" : "（下一階段）"}</option>)}</select></Field>
          )}
          <Field label="連接器識別名稱 (Connector Label) *" hint="建議標記科別與專用功能，便於沙盒追蹤。" right={<span className="mono">唯一識別碼</span>}>
            <input value={form.label} placeholder={spec.label} onChange={(e) => setForm((x) => ({ ...x, label: e.target.value }))} disabled={!editable} /></Field>
          <Field label="適用情境與臨床呼叫範圍 (Clinical Scope)"><input value={form.scope} placeholder="急診重症、心導管室異常警報即時通知、會診值班專責呼叫" onChange={(e) => setForm((x) => ({ ...x, scope: e.target.value }))} disabled={!editable} /></Field>
          <span className="label">連接協定類型 (Protocol Architecture)</span>
          <div className="grid gap-2 md:grid-cols-3">
            {[["mcp", "MCP Server", "Model Context Protocol · Streamable HTTP（推薦）"], ["webhook", "Webhook / REST", "標準 HTTP JSON Payload 推播"], [spec.id, spec.label, spec.protocol]]
              .filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i).map(([v, l, h]) => (
              <button key={v} type="button" disabled={!isNew} onClick={() => { setTypeId(v); setForm((x) => ({ ...x, type: v, config: {}, secrets: {}, label: "" })); }}
                className={`rounded-lg border px-3 py-2 text-left text-xs ${typeId === v ? "border-primary bg-primary-tint" : "border-hairline bg-surface-container-low"}`}>
                <span className="flex items-center gap-2 font-semibold"><span className={`h-3 w-3 rounded-full border ${typeId === v ? "border-primary bg-primary" : "border-outline"}`} />{l}</span><span className="ml-5 block text-outline">{h}</span></button>))}
          </div>
        </Section>

        <Section n="02" title="伺服器與端點連線 (Server & Endpoints)">
          {serverFields.length ? serverFields.map(renderField) : <p className="text-sm text-on-surface-variant">此類型沒有非機密的端點設定。</p>}
          <div className="mt-4 rounded-lg bg-surface-container-low px-3 py-2 text-xs">
            <p className="flex items-center justify-between font-semibold"><span><Icon name="call_received" className="mr-1 text-[14px]" />中榮 Gateway 監聽回調 URL (Callback URL)</span><span className="mono">唯讀 (System Generated)</span></p>
            <p className="mt-1 font-mono text-on-surface-variant">{window.location.origin}/api/connectors/callback/{existing?.id ?? "<id>"}</p>
            <p className="mt-1 text-outline">雙向互動（Slack Event Subscriptions、Teams 回覆）於下一階段啟用。</p>
          </div>
        </Section>

        <Section n="03" title="授權憑證與安全性 (Credentials & Security)">
          {credFields.length ? credFields.map(renderField) : <p className="text-sm text-on-surface-variant">此類型不需要憑證。</p>}
        </Section>

        <Section n="04" title="醫療審核閘道與合規設定 (Healthcare Audit & Guardrails)">
          {[["redact_pii", "shield", "自動過濾病患個資 (PII Redaction Engine)", "送出前以 Sensitive Data Protection 將姓名、病歷號、身分證替換為識別標籤。", "強制啟用"],
            ["audit_payloads", "receipt_long", "記錄所有 Payload 至中榮稽核日誌 (Audit Log)", "每次工具呼叫的參數與結果狀態寫入 audit 集合供資安審查。", "保留 180 天"]].map(([k, icon, title, desc, tag]) => (
            <label key={k} className="mb-2 flex items-center gap-4 rounded-lg bg-surface-container-low px-4 py-3">
              <Icon name={icon} className="text-primary" />
              <span className="flex-1"><span className="flex items-center gap-2 text-sm font-semibold">{title} <span className="chip">{tag}</span></span><span className="block text-xs text-on-surface-variant">{desc}</span></span>
              <input type="checkbox" className="switch" checked={Boolean(form[k as "redact_pii" | "audit_payloads"])} disabled={!editable} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.checked }))} />
            </label>))}
        </Section>

        {test && (
          <section className={`card border-l-4 p-5 ${test.ok ? "border-l-primary" : "border-l-error"}`}>
            <p className="flex items-center gap-2 font-semibold"><Icon name={test.ok ? "check_circle" : "error"} className={test.ok ? "text-primary" : "text-error"} />測試結果：{test.message} <span className="mono">{test.ms} ms</span></p>
            {test.tools && test.tools.length > 0 && (
              <div className="mt-3"><p className="mono mb-1">伺服器註冊工具（{test.tools.length}）</p>
                <div className="flex flex-wrap gap-1.5">{test.tools.map((t) => <span key={t.id} className="chip" title={t.description}>{t.id}</span>)}</div></div>)}
          </section>
        )}

        <div className="sticky bottom-0 -mx-5 flex items-center gap-4 border-t border-hairline bg-white/95 px-5 py-3 text-sm">
          <button className="btn-ghost" onClick={() => nav("/connectors")}>取消 (Cancel)</button>
          {existing && editable && <button className="btn-danger" onClick={remove} disabled={!!busy}><Icon name="delete" className="text-[16px]" />刪除連接器</button>}
          <span className="flex-1" />
          {saved && <span className="mono">上次儲存：{saved}</span>}
          {editable && <button className="btn-primary px-5 py-2.5" onClick={save} disabled={!!busy}>{busy === "save" ? <Spinner /> : <Icon name="sync" className="text-[18px]" />}儲存設定並同步至 Agent (Save & Sync Connector)</button>}
        </div>
      </div>
    </div>
  );
}
