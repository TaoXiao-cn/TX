# 生产 API 镜像（课题进度 MVP）
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @project-progress/api

COPY apps/api apps/api
RUN npm run build -w @project-progress/api

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# PDF 导出中文字体
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-wqy-zenhei \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @project-progress/api --omit=dev

COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "dist/index.js"]
