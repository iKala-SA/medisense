"""Calibrate the chat's retrieval relevance thresholds (READ-ONLY: it never writes to Firestore, GCS or the corpus).

Vertex RAG's `score` is a DISTANCE: smaller = more similar. The chat keeps a passage when distance <= rag_keep_distance,
keeps-but-flags 低相關 up to rag_max_distance, and drops anything farther (config/features, editable on the 路由 admin
page). The defaults came from the sandbox corpus; run this against the real hospital documents before relying on them.

  cd backend && set -a && . ./.env && set +a            # same env as the other scripts; uses your gcloud ADC login
  .venv/bin/python -m scripts.calibrate_rag
  .venv/bin/python -m scripts.calibrate_rag --questions-per-doc 3 --skip "patient|ehr"   # leave files out by name regex

What it does
  1. lists the indexed library documents (names only),
  2. takes passages from each document and asks a model (through LITELLM_BASE_URL) to write a natural question each
     passage answers; the passages are already de-identified library text, like in normal chat,
  3. runs every question, and a set of questions the library cannot answer, through the same retrieval the chat uses,
  4. prints the distance distributions, and a suggested (keep, max) pair.
Only distances, file names and the generated questions are printed, never passage text.
"""
import argparse
import os
import re
import statistics as st

os.environ.setdefault("LITELLM_API_KEY", os.environ.get("LITELLM_API_KEY", "unused"))

ABSENT = ["hello", "今天天氣如何", "紅燒肉怎麼做", "台積電股價", "世界盃足球賽冠軍是誰",
          "糖尿病口服降血糖藥怎麼調整劑量", "急性心肌梗塞的處置流程", "兒童退燒藥的劑量"]  # replace with topics YOUR library lacks


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions-per-doc", type=int, default=3)
    ap.add_argument("--skip", default="", help="regex: document names to leave out")
    ap.add_argument("--model", default="gemini-3-flash", help="LiteLLM model that writes the questions")
    args = ap.parse_args()

    from openai import OpenAI

    from app import db
    from app.config import settings
    from app.engine import rag

    docs = {d.id: d.to_dict() or {} for d in db.client().collection("documents").stream()}
    skip = re.compile(args.skip, re.I) if args.skip else None
    idx: dict[str, str] = {}
    for d in docs.values():
        if d.get("status") == "indexed" and d.get("rag_file") and not (skip and skip.search(d.get("name", ""))):
            idx.setdefault(d["name"], d["rag_file"])
    print(f"{len(idx)} indexed documents in scope")
    corpus, files = rag.hospital_corpus(), list(idx.values())
    llm = OpenAI(base_url=f"{settings().litellm_base_url.rstrip('/')}/v1", api_key=settings().litellm_api_key)

    hits, misses = [], []
    for name, rf in idx.items():
        stem = re.sub(r"\.[A-Za-z0-9]+$", "", name)
        seen, passages = set(), []
        for q in [stem, "說明", "步驟與規則", "重點整理", "注意事項", "範例"]:
            for c in rag.retrieve(corpus, [rf], q, top_k=5):
                if c["text"][:60] not in seen and len(c["text"]) > 150 and len(passages) < args.questions_per_doc:
                    seen.add(c["text"][:60])
                    passages.append(c)
        for p in passages:
            ask = "根據下列文字寫一個使用者可能會問的自然問題（一句話，不要照抄原文用字，答案必須在這段文字裡）。只輸出問題。\n\n" + p["text"][:700]
            q = llm.chat.completions.create(model=args.model, messages=[{"role": "user", "content": ask}],
                                            max_tokens=600).choices[0].message.content.strip().replace("\n", " ")
            r = rag.retrieve(corpus, files, q, top_k=5)
            if r and r[0]["score"] is not None:
                (hits if r[0]["source"] == name else misses).append(r[0]["score"])
                print(f"  {r[0]['score']:.3f}  {'right file' if r[0]['source'] == name else 'WRONG FILE'}  {q[:50]}")
    absent = []
    for q in ABSENT:
        r = rag.retrieve(corpus, files, q, top_k=5)
        absent += [c["score"] for c in r[:1] if c["score"] is not None]
        print(f"  {r[0]['score']:.3f}  absent        {q}" if r else f"  (no result)   absent        {q}")

    def dist(label: str, xs: list[float]) -> None:
        if xs:
            xs = sorted(xs)
            print(f"{label:34s} n={len(xs):3d} min={xs[0]:.3f} median={st.median(xs):.3f} p90={xs[int(len(xs) * 0.9) - 1]:.3f} max={xs[-1]:.3f}")

    print()
    dist("top-1 is the RIGHT file", hits)
    dist("top-1 is another file", misses)
    dist("question the library cannot answer", absent)
    if hits and absent:
        keep = round(sorted(hits)[int(len(hits) * 0.9) - 1] + 0.01, 2)
        mx = round(max(keep, min(absent) - 0.01), 2)
        print(f"\nsuggested starting point: rag_keep_distance={keep}  rag_max_distance={mx}")
        print("(keep = just above 90% of the right-file hits; max = just below the nearest unanswerable question.\n"
              " Lean toward a LARGER max: dropping a useful guideline is worse than showing a weak one.)")


if __name__ == "__main__":
    main()
