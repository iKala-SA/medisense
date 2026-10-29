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
    {"key": "gpt-oss-120b", "name": "gpt-oss 120B（院內）", "provider": "自架開源", "litellm_model": "openai/gpt-oss-120b",
     "group": "sovereign", "deploy": "onprem", "needs_api_base": True, "description": "院內 vLLM 伺服器上的開源模型，資料不出院。需填伺服器位址。"},
    {"key": "gpt-oss-20b", "name": "gpt-oss 20B（院內）", "provider": "自架開源", "litellm_model": "openai/gpt-oss-20b",
     "group": "sovereign", "deploy": "onprem", "needs_api_base": True, "description": "較小的院內開源模型，資源需求較低。需填伺服器位址。"},
    # Ollama ids are "<family><version>:<size>" (ollama.com/library); LiteLLM's ollama_chat/ prefix uses Ollama's chat API,
    # which is what carries tool calls (gemma3 has no tool template in Ollama; gemma4 does, so agents with knowledge work).
    {"key": "gemma-4-12b", "name": "Gemma 4 12B（院內）", "provider": "ollama", "litellm_model": "ollama_chat/gemma4:12b",
     "group": "sovereign", "deploy": "onprem", "needs_api_base": True,
     "description": "院內 Ollama 伺服器上的 Google 開放權重模型，支援工具呼叫與視覺，資料不出院。需填伺服器位址（例如 http://10.140.0.31:11434 或 os.environ/OLLAMA_API_BASE）。"},
    # Bedrock keyless: the renderer adds aws_role_name / aws_web_identity_token / aws_region_name (BEDROCK_* env, infra/env.sh).
    {"key": "nova-2-lite", "name": "Amazon Nova 2 Lite", "provider": "bedrock", "litellm_model": "bedrock/jp.amazon.nova-2-lite-v1:0",
     "group": "budget", "deploy": "cloud", "description": "AWS Bedrock（東京）上的低成本模型，透過平台服務帳戶免金鑰呼叫。"},
]
BY_KEY = {m["key"]: m for m in CATALOG}
