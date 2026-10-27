import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./ui";

// Skills attached to an agent (ordered by selection). Enabled skills are prepended to each LLM step's system prompt.
export default function SkillsPanel({ ids, editable, onChange }) {
  const [skills, setSkills] = useState(null);
  useEffect(() => {
    let live = true;
    api.listSkills().then((s) => live && setSkills(s || [])).catch(() => live && setSkills([]));
    return () => { live = false; };
  }, []);
  const toggle = (id) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="section-title text-sm"><Icon name="bolt" className="text-primary" />技能 (Skills)</p>
        <span className="chip">{ids.length} 項已套用</span>
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">已啟用的技能指示會依勾選順序加到每個 LLM 步驟的系統提示前；變更後請按「儲存草稿」。</p>
      <div className="mt-3 space-y-1.5">
        {skills === null ? <p className="text-xs text-outline">載入中…</p>
          : !skills.length ? <p className="text-xs text-outline">尚未建立技能，可到「技能」頁新增。</p>
          : skills.map((k) => <label key={k.id} className="flex items-center gap-2 rounded border border-hairline px-3 py-2 text-xs">
              <input type="checkbox" disabled={!editable} checked={ids.includes(k.id)} onChange={() => toggle(k.id)} />
              <span className="font-semibold text-on-surface">{k.name}</span>
              <span className="ml-auto text-outline">{k.enabled ? "啟用中" : "已停用（執行時略過）"}</span>
            </label>)}
      </div>
    </div>;
}
