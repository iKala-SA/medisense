import { useEffect, useState } from "react";
import { api } from "./api";
let cached = null;
function useModelGroups() {
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    cached ??= api.modelGroups().then((r) => r.groups).catch(() => {
      cached = null;
      return [];
    });
    cached.then(setGroups);
  }, []);
  return groups;
}
function describeGroup(groups, id) {
  const g = groups.find((x) => x.id === id);
  if (!groups.length) return "";
  if (!g?.configured) return id === "sovereign" ? "\u5C1A\u672A\u8A2D\u5B9A\u9662\u5167\u6A21\u578B\uFF1A\u57F7\u884C\u6703\u5931\u6557\uFF08\u523B\u610F\u4E0D\u56DE\u9000\u96F2\u7AEF\uFF09" : "LiteLLM \u5C1A\u672A\u8A2D\u5B9A\u6B64\u7FA4\u7D44\uFF1A\u57F7\u884C\u6703\u5931\u6557";
  const chain = g.fallbacks.map((f) => f.models.length && f.models.join() !== f.name ? `${f.name} (${f.models.join(", ")})` : f.name);
  return `${g.models.join(" / ")}${chain.length ? ` \u2192 \u5099\u63F4 ${chain.join(" \u2192 ")}` : "\uFF08\u7121\u5099\u63F4\uFF09"}`;
}
export {
  describeGroup,
  useModelGroups
};
