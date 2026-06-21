FROM node:20-slim AS frontend

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts/routegenie ./artifacts/routegenie

RUN pnpm install --frozen-lockfile
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm --filter @workspace/routegenie build


FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY artifacts/api-server/requirements.txt ./artifacts/api-server/requirements.txt
RUN pip install --no-cache-dir -r ./artifacts/api-server/requirements.txt

COPY artifacts/api-server ./artifacts/api-server
COPY --from=frontend /app/artifacts/routegenie/dist/public ./artifacts/routegenie/dist/public

WORKDIR /app/artifacts/api-server
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
