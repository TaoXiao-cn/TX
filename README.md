# 课题进度（MVP）

面向个人科研/课题的进度管理 Web 应用：多课题、富文本进度、图片与附件、时间轴、导出 PDF/DOCX/MD，数据云端同步。

## 技术栈

- 前端：React + TypeScript + Vite + Ant Design + TipTap
- 后端：Node.js + Hono
- 数据库：PostgreSQL
- 鉴权：邮箱 + 密码（JWT）
- 附件：S3 兼容对象存储（本地用 MinIO）

## 快速开始

### 1. 启动基础设施

```bash
docker compose up -d
```

会启动：

- Postgres：`localhost:5432`（用户/密码/库均为 `progress`）
- S3 Mock：`localhost:9000`（`adobe/s3mock`，预置 bucket `attachments`）

> 说明：部分环境无法拉取 `minio/minio`，compose 默认用 S3 Mock。换真实 MinIO / S3 时只需改 `.env` 中的 `S3_*`。

### 2. 配置环境变量

```bash
cp .env.example .env
```

本地默认值可直接使用；部署到托管 Postgres / S3 时只改 `.env`。

### 3. 安装依赖并初始化

```bash
npm install
npm run db:migrate
npm run db:seed
```

### 4. 启动开发服务

开两个终端：

```bash
npm run dev:api
npm run dev:web
```

- 前端：http://localhost:5173
- API：http://localhost:8787

## 演示账号

种子数据会写入：

| 项目 | 值 |
|------|-----|
| 邮箱 | `demo@example.com` |
| 密码 | `demo123456` |

登录后可见示例课题「示例课题：光合作用机制」。

## 环境变量说明

见 `.env.example`：

| 变量 | 含义 |
|------|------|
| `DATABASE_URL` | Postgres 连接串 |
| `JWT_SECRET` | JWT 签名密钥（生产务必更换） |
| `CORS_ORIGIN` | 允许的前端源 |
| `S3_*` | S3 / MinIO 配置 |
| `VITE_API_BASE_URL` | 前端请求的 API 根地址 |

## MVP 功能

1. 注册 / 登录 / 登出
2. 课题：创建、重命名、归档、列表
3. **子课题方向**：课题下可建多个方向；进度归属所选方向；可重命名/归档
4. 进度条目：TipTap 富文本、图片与附件、时间轴按日分隔；编辑只更新 `updatedAt`
5. 导出：整课题（按方向分组）或单方向 · Markdown / DOCX / PDF
6. 本地 `docker compose` 一键起库与对象存储

## 仓库结构

```
apps/
  api/   # Hono API
  web/   # React 前端
docker-compose.yml
.env.example
```

## PDF 中文

导出 PDF 必须嵌入仓库自带的 **TrueType** Noto Sans SC（`apps/api/assets/fonts/NotoSansSC-Regular.ttf`，SIL OFL）。pdfkit 默认 Helvetica 是 WinAnsi，不能画中文。OTF/CFF 会被嵌成 CIDFontType0，Chrome、Safari、macOS 预览不认这种子集，中文仍会乱码。不要改回 OTF、系统字体路径，也不要在缺字时回退到 Helvetica。生产镜像由 `apps/api/Dockerfile` 复制该 TTF，不依赖宿主机是否安装了字体。`/health` 会返回 `pdfFontFormat: "truetype"`。

Markdown / DOCX 保存的是 Unicode 文本，不依赖嵌入字体。

## 腾讯云公网部署

Sean 已选定 **腾讯云 + 全量公网部署（方案 B）**。完整步骤（架构、控制台清单、环境变量映射、安全与验收）见项目文档：

- **部署方案：** Cursor Project 商店 `docs/tencent-cloud-deploy.md`
- **产品方案（含托管决策）：** 同目录 `docs/product-plan.md`

本仓库生产向文件：

| 文件 | 用途 |
|------|------|
| `docker-compose.prod.yml` | 仅 API + Nginx 前端；库与 COS 用云端 |
| `apps/api/Dockerfile` | API 生产镜像 |
| `apps/web/Dockerfile` + `nginx.conf` | 静态站 + `/api` 反代 |
| `.env.example` | 含腾讯云 COS 注释；复制为服务器上的 `.env.prod`（勿提交） |

服务器上摘要：

```bash
cp .env.example .env.prod   # 按部署方案填写；密钥勿提交、勿发聊天
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api node dist/db/migrate.js
```

COS 生产务必 `S3_FORCE_PATH_STYLE=false`；防火墙公网仅开 80/443/22（22 限 IP）。

## Git / PR

```bash
git push -u origin cursor/mvp-scaffold-1a38
# 生产准备分支（若已创建）：
git push -u origin cursor/tencent-deploy-prep-ff7a
```
