"""Models an admin can register with one click (模型 → 可選模型). Each entry becomes a normal registry row
(models/{id}); nothing reaches LiteLLM until 套用到 LiteLLM. Cloud entries here run on Vertex AI with the platform's
service account (no secret to create); on-prem entries are templates that need the address of the hospital's own server.
Anything not listed can still be added by hand with 新增模型."""

CATALOG: list[dict] = [
    {"key": "gemini-3-flash", "name": "Gemini 3 Flash", "provider": "Google", "litellm_model": "vertex_ai/gemini-3-flash-preview",
     "group": "fast", "deploy": "cloud", "description": "快速一般問答，預設的 fast 群組模型。"},
    {"key": "gemini-3-1-pro", "name": "Gemini 3.1 Pro", "provider": "Google", "litellm_model": "vertex_ai/gemini-3.1-pro-preview",
     "group": "reasoning", "deploy": "cloud", "description": "複雜分析與多模態工作。"},
    {"key": "gemini-2-5-flash", "name": "Gemini 2.5 Flash", "provider": "Google", "litellm_model": "vertex_ai/gemini-2.5-flash",
     "group": "budget", "deploy": "cloud", "description": "低成本、批次與一般文字任務。"},
    {"key": "gemini-2-5-pro", "name": "Gemini 2.5 Pro", "provider": "Google", "litellm_model": "vertex_ai/gemini-2.5-pro",
     "group": "reasoning", "deploy": "cloud", "description": "穩定版的進階推理模型。"},
    {"key": "gemini-2-5-flash-lite", "name": "Gemini 2.5 Flash-Lite", "provider": "Google", "litellm_model": "vertex_ai/gemini-2.5-flash-lite",
     "group": "budget", "deploy": "cloud", "description": "最省成本，適合簡單分類與摘要。"},
    {"key": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "provider": "Anthropic", "litellm_model": "vertex_ai/claude-sonnet-5-5",
     "group": "reasoning", "deploy": "cloud", "description": "Anthropic 的主力模型，經 Vertex AI 提供，不需另外建立金鑰。"},
    {"key": "claude-opus-5-5", "name": "Claude Opus 5.5", "provider": "Anthropic", "litellm_model": "vertex_ai/claude-opus-5-5",
     "group": "reasoning", "deploy": "cloud", "description": "最強推理與長文件分析，經 Vertex AI 提供，成本較高。"},
    {"key": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "provider": "Anthropic", "litellm_model": "vertex_ai/claude-haiku-5-5",
     "group": "budget", "deploy": "cloud", "description": "快速低成本，適合簡單問答與分類，經 Vertex AI 提供。"},
    {"key": "azure-openai", "name": "Azure OpenAI（自訂部署）", "provider": "Azure", "litellm_model": "azure/{deployment}",
     "group": "reasoning", "deploy": "cloud", "needs_deployment": True, "needs_api_base": True, "needs_secret": True,
     "description": "貴院 Azure OpenAI 資源上的部署。需填部署名稱、資源位址，以及 Secret Manager 中金鑰的名稱（不是金鑰內容）。"},
    {"key": "gpt-oss-120b", "name": "gpt-oss 120B（院內）", "provider": "自架開源", "litellm_model": "openai/gpt-oss-120b",
     "group": "sovereign", "deploy": "onprem", "needs_api_base": True, "description": "院內 vLLM 伺服器上的開源模型，資料不出院。需填伺服器位址。"},
    {"key": "gpt-oss-20b", "name": "gpt-oss 20B（院內）", "provider": "自架開源", "litellm_model": "openai/gpt-oss-20b",
     "group": "sovereign", "deploy": "onprem", "needs_api_base": True, "description": "較小的院內開源模型，資源需求較低。需填伺服器位址。"},
]
BY_KEY = {m["key"]: m for m in CATALOG}
