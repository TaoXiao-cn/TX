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
3. 进度条目：TipTap 富文本、图片与附件、时间轴按日分隔；编辑只更新 `updatedAt`
4. 导出：Markdown / DOCX / PDF
5. 本地 `docker compose` 一键起库与对象存储

## 仓库结构

```
apps/
  api/   # Hono API
  web/   # React 前端
docker-compose.yml
.env.example
```

## PDF 中文

服务端 PDF 会尝试加载系统 CJK 字体（如 Linux 上的 `DroidSansFallbackFull.ttf` / 文泉驿）。若导出 PDF 缺字，请安装对应字体后重启 API。

## Git / PR

当前 Cloud Agent 环境未关联 GitHub remote。Sean 可在 GitHub 建空仓库后：

```bash
git remote add origin <你的仓库 URL>
git push -u origin cursor/mvp-scaffold-1a38
# 再在 GitHub 上从该分支开 PR
```
