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
# 必须是 TrueType。OTF/CFF 会嵌成 CIDFontType0，Chrome/Safari/预览会退回 Helvetica，中文仍乱码。
COPY apps/api/assets/fonts/NotoSansSC-Regular.ttf /usr/local/share/fonts/NotoSansSC-Regular.ttf
COPY apps/api/assets/fonts/NotoSansSC-Regular.ttf /app/apps/api/dist/fonts/NotoSansSC-Regular.ttf
COPY apps/api/assets/fonts /app/apps/api/assets/fonts

WORKDIR /app/apps/api
EXPOSE 8787
CMD ["node", "dist/index.js"]
