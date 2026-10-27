# LiteLLM proxy with our routing config baked in. Built by Cloud Build (03-deploy-litellm.sh).
# Pin the tag before TCVGH production; main-stable moves.
FROM ghcr.io/berriai/litellm:main-stable
COPY config.yaml /app/config.yaml
EXPOSE 4000
