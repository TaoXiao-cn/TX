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

ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @project-progress/api --omit=dev

COPY --from=build /app/apps/api/dist apps/api/dist
# PDF 中文必须用仓库里的 Noto Sans SC。文泉驿 .ttc 与 Helvetica 都不能嵌入中文。
COPY apps/api/assets/fonts apps/api/assets/fonts

WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "dist/index.js"]
