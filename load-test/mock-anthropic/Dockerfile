FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
ENV PORT=8080
EXPOSE 8080
# Exec form — no shell, so the process IS PID 1 and receives SIGTERM directly.
# (`sh -c` with a CHAINED command would swallow it; see docker/Dockerfile.api,
# where exactly that cost us every graceful shutdown until M6 found it.)
CMD ["node", "server.mjs"]
