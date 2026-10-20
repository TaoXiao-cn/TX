import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import { pool } from "../db/pool.js";
import { requireAuth, verifyToken, type AuthUser } from "../lib/auth.js";
import {
  deleteObject,
  getObjectBuffer,
  putObject,
  publicUrlFor,
} from "../lib/s3.js";
import { assertDirectionOwned } from "./directions.js";

type Vars = { user: AuthUser };

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "application/zip",
]);

const MAX_BYTES = 20 * 1024 * 1024;

export const entryRoutes = new Hono<{ Variables: Vars }>();

entryRoutes.use("*", async (c, next) => {
  // 附件预览可用 ?token=，因此该路径不走强制 Bearer 中间件
  if (c.req.path.match(/\/attachments\/[^/]+\/file$/)) {
    return next();
  }
  return requireAuth(c, next);
});

function mapAttachment(row: Record<string, unknown>) {
  const id = String(row.id);
  return {
    id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storageKey: row.storage_key,
    // 经 API 代理，避免本地 S3 Mock / 私有桶 CORS 问题
    url: `/api/attachments/${id}/file`,
    publicUrl: publicUrlFor(String(row.storage_key)),
    createdAt: row.created_at,
  };
}

function mapEntry(
  row: Record<string, unknown>,
  attachments: ReturnType<typeof mapAttachment>[],
) {
  return {
    id: row.id,
    projectId: row.project_id,
    directionId: row.direction_id,
    contentJson: row.content_json,
    contentHtml: row.content_html,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
  };
}

async function loadEntriesForDirection(directionId: string) {
  const entries = await pool.query(
    `SELECT * FROM progress_entries
     WHERE direction_id = $1
     ORDER BY created_at DESC`,
    [directionId],
  );
  const ids = entries.rows.map((r) => r.id);
  let attachmentsByEntry = new Map<string, ReturnType<typeof mapAttachment>[]>();
  if (ids.length) {
    const atts = await pool.query(
      `SELECT * FROM attachments WHERE entry_id = ANY($1::uuid[])`,
      [ids],
    );
    attachmentsByEntry = atts.rows.reduce((map, row) => {
      const list = map.get(row.entry_id) ?? [];
      list.push(mapAttachment(row));
      map.set(row.entry_id, list);
      return map;
    }, new Map<string, ReturnType<typeof mapAttachment>[]>());
  }

  return entries.rows.map((row) =>
    mapEntry(row, attachmentsByEntry.get(row.id) ?? []),
  );
}

entryRoutes.get("/directions/:directionId/entries", async (c) => {
  const user = c.get("user");
  const directionId = c.req.param("directionId");
  if (!(await assertDirectionOwned(directionId, user.id))) {
    return c.json({ error: "方向不存在" }, 404);
  }

  return c.json({
    entries: await loadEntriesForDirection(directionId),
  });
});

entryRoutes.post("/directions/:directionId/entries", async (c) => {
  const user = c.get("user");
  const directionId = c.req.param("directionId");
  const direction = await assertDirectionOwned(directionId, user.id);
  if (!direction) {
    return c.json({ error: "方向不存在" }, 404);
  }

  const body = await c.req.json<{
    contentJson?: unknown;
    contentHtml?: string;
  }>();

  const result = await pool.query(
    `INSERT INTO progress_entries (project_id, direction_id, content_json, content_html)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING *`,
    [
      direction.project_id,
      directionId,
      JSON.stringify(body.contentJson ?? { type: "doc", content: [] }),
      body.contentHtml ?? "",
    ],
  );

  await pool.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [
    direction.project_id,
  ]);
  await pool.query(`UPDATE directions SET updated_at = NOW() WHERE id = $1`, [
    directionId,
  ]);

  return c.json({ entry: mapEntry(result.rows[0], []) }, 201);
});

entryRoutes.patch("/entries/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    contentJson?: unknown;
    contentHtml?: string;
  }>();

  const owned = await pool.query(
    `SELECT e.* FROM progress_entries e
     JOIN projects p ON p.id = e.project_id
     WHERE e.id = $1 AND p.owner_user_id = $2`,
    [id, user.id],
  );
  if (!owned.rows[0]) return c.json({ error: "条目不存在" }, 404);

  // created_at 不变；仅更新内容与 updated_at
  const result = await pool.query(
    `UPDATE progress_entries SET
       content_json = COALESCE($1::jsonb, content_json),
       content_html = COALESCE($2, content_html),
       updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [
      body.contentJson !== undefined
        ? JSON.stringify(body.contentJson)
        : null,
      body.contentHtml ?? null,
      id,
    ],
  );

  const atts = await pool.query(
    `SELECT * FROM attachments WHERE entry_id = $1`,
    [id],
  );

  return c.json({
    entry: mapEntry(
      result.rows[0],
      atts.rows.map(mapAttachment),
    ),
  });
});

entryRoutes.delete("/entries/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const owned = await pool.query(
    `SELECT e.id FROM progress_entries e
     JOIN projects p ON p.id = e.project_id
     WHERE e.id = $1 AND p.owner_user_id = $2`,
    [id, user.id],
  );
  if (!owned.rows[0]) return c.json({ error: "条目不存在" }, 404);

  const atts = await pool.query(
    `SELECT storage_key FROM attachments WHERE entry_id = $1`,
    [id],
  );
  await pool.query(`DELETE FROM progress_entries WHERE id = $1`, [id]);
  for (const row of atts.rows) {
    try {
      await deleteObject(row.storage_key);
    } catch {
      // ignore cleanup errors
    }
  }
  return c.json({ ok: true });
});

entryRoutes.get("/attachments/:id/file", async (c) => {
  const header = c.req.header("authorization");
  const queryToken = c.req.query("token");
  const raw = header?.startsWith("Bearer ")
    ? header.slice(7)
    : queryToken || "";
  if (!raw) return c.json({ error: "未登录" }, 401);

  let user: AuthUser;
  try {
    user = await verifyToken(raw);
  } catch {
    return c.json({ error: "登录已失效" }, 401);
  }

  const id = c.req.param("id");
  const result = await pool.query(
    `SELECT a.* FROM attachments a
     JOIN progress_entries e ON e.id = a.entry_id
     JOIN projects p ON p.id = e.project_id
     WHERE a.id = $1 AND p.owner_user_id = $2`,
    [id, user.id],
  );
  const row = result.rows[0];
  if (!row) return c.json({ error: "附件不存在" }, 404);

  try {
    const buf = await getObjectBuffer(row.storage_key);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": row.mime_type,
        "Content-Disposition": `inline; filename="${encodeURIComponent(row.file_name)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return c.json({ error: "读取附件失败" }, 500);
  }
});

entryRoutes.post("/entries/:id/attachments", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const owned = await pool.query(
    `SELECT e.id FROM progress_entries e
     JOIN projects p ON p.id = e.project_id
     WHERE e.id = $1 AND p.owner_user_id = $2`,
    [id, user.id],
  );
  if (!owned.rows[0]) return c.json({ error: "条目不存在" }, 404);

  const form = await c.req.parseBody();
  const file = form.file;
  if (!file || typeof file === "string") {
    return c.json({ error: "请上传文件" }, 400);
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return c.json({ error: `不支持的文件类型：${mime}` }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return c.json({ error: "文件不能超过 20MB" }, 400);
  }

  const key = `entries/${id}/${uuid()}-${file.name}`;
  await putObject({ key, body: buf, contentType: mime });

  const result = await pool.query(
    `INSERT INTO attachments (entry_id, file_name, mime_type, size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, file.name, mime, buf.byteLength, key],
  );

  await pool.query(
    `UPDATE progress_entries SET updated_at = NOW() WHERE id = $1`,
    [id],
  );

  return c.json({ attachment: mapAttachment(result.rows[0]) }, 201);
});
