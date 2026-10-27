import { useEffect, useState } from "react";
import { api } from "./api";
import type { ModelGroup, ModelGroupInfo } from "./types";

let cached: Promise<ModelGroupInfo[]> | null = null;

/** Live LiteLLM routing table, fetched once per page load. Empty until it arrives (or if it fails). */
export function useModelGroups(): ModelGroupInfo[] {
  const [groups, setGroups] = useState<ModelGroupInfo[]>([]);
  useEffect(() => {
    cached ??= api.modelGroups().then((r) => r.groups).catch(() => { cached = null; return []; });
    cached.then(setGroups);
  }, []);
  return groups;
}

/** "gemini-3-flash-preview → 備援 gemini-2.5-flash", or why it will not run. */
export function describeGroup(groups: ModelGroupInfo[], id: ModelGroup): string {
  const g = groups.find((x) => x.id === id);
  if (!groups.length) return "";
  if (!g?.configured) return id === "sovereign" ? "尚未設定院內模型：執行會失敗（刻意不回退雲端）" : "LiteLLM 尚未設定此群組：執行會失敗";
  const chain = g.fallbacks.map((f) => (f.models.length && f.models.join() !== f.name ? `${f.name} (${f.models.join(", ")})` : f.name));
  return `${g.models.join(" / ")}${chain.length ? ` → 備援 ${chain.join(" → ")}` : "（無備援）"}`;
}
