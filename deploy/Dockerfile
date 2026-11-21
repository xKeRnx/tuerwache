FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 libgl1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY LICENSE.md ./
RUN npm ci --omit=dev
RUN npm --prefix node_modules/ffmpeg-for-homebridge run install && node_modules/ffmpeg-for-homebridge/ffmpeg -version >/dev/null
COPY --chown=node:node ai ./ai
RUN python3 ai/install-models.py
RUN python3 -m venv /opt/ai && /opt/ai/bin/pip install --no-cache-dir -r ai/requirements.txt && mkdir -p /app/data/state /app/backups && chown -R node:node /app/data /app/backups
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
ENV NODE_ENV=production HOST=127.0.0.1 PORT=3210 AI_PYTHON=/opt/ai/bin/python DATA_DIRECTORY=/app/data/state
USER node
EXPOSE 3210
CMD ["node", "src/server.mjs"]
