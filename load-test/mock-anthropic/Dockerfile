FROM node:22-alpine
WORKDIR /app
# ⚠️ Path is relative to the REPO ROOT, not to this file. Railway builds with
# the repository as the context when RAILWAY_DOCKERFILE_PATH points here, so a
# bare `COPY server.mjs` fails with a file-not-found that reads like the file is
# missing. Same shape as docker/Dockerfile.bazi's `COPY packages/bazi-engine/`.
COPY load-test/mock-anthropic/server.mjs ./
ENV PORT=8080
EXPOSE 8080
# Exec form — no shell, so the process IS PID 1 and receives SIGTERM directly.
# (`sh -c` with a CHAINED command would swallow it; see docker/Dockerfile.api,
# where exactly that cost us every graceful shutdown until M6 found it.)
CMD ["node", "server.mjs"]
