# LiteLLM proxy with our routing config baked in. Built by Cloud Build (03-deploy-litellm.sh).
# Pinned by digest because main-stable moves. This digest is LiteLLM 1.106.5 (built 2026-10-27), checked to
# support complexity_router custom_dimensions. To upgrade, re-resolve main-stable and re-test smart-router.
FROM ghcr.io/berriai/litellm:main-stable@sha256:7d6ae6c8d73d1b6aea4cb75d07c4a8a953f0809b0764522b8eab693734c5e905
COPY config.yaml /app/config.yaml
EXPOSE 4000
