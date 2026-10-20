import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";
import { deleteObjectsBestEffort } from "../lib/s3.js";

type Vars = { user: AuthUser };

export const projectRoutes = new Hono<{ Variables: Vars }>();

projectRoutes.use("*", requireAuth);

function mapProject(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function attachmentKeysForProject(projectId: string) {
  const result = await pool.query(
    `SELECT a.storage_key
     FROM attachments a
     JOIN progress_entries e ON e.id = a.entry_id
     WHERE e.project_id = $1`,
    [projectId],
  );
  return result.rows.map((r) => r.storage_key as string);
}

projectRoutes.get("/", async (c) => {
  const user = c.get("user");
  const status = c.req.query("status") ?? "active";
  const result = await pool.query(
    `SELECT * FROM projects
     WHERE owner_user_id = $1 AND ($2 = 'all' OR status = $2)
     ORDER BY updated_at DESC`,
    [user.id, status],
  );
  return c.json({ projects: result.rows.map(mapProject) });
});

projectRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ title?: string; description?: string }>();
  const title = body.title?.trim();
  if (!title) return c.json({ error: "课题名称不能为空" }, 400);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO projects (owner_user_id, title, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, title, body.description?.trim() ?? ""],
    );
    const project = result.rows[0];
    await client.query(
      `INSERT INTO directions (project_id, title, description)
       VALUES ($1, $2, $3)`,
      [project.id, "默认方向", ""],
    );
    await client.query("COMMIT");
    return c.json({ project: mapProject(project) }, 201);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

projectRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    description?: string;
    status?: "active" | "archived";
  }>();

  const owned = await pool.query(
    `SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [id, user.id],
  );
  if (!owned.rows[0]) return c.json({ error: "课题不存在" }, 404);

  const result = await pool.query(
    `UPDATE projects SET
       title = COALESCE($1, title),
       description = COALESCE($2, description),
       status = COALESCE($3, status),
       updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [
      body.title?.trim() ?? null,
      body.description !== undefined ? body.description.trim() : null,
      body.status ?? null,
      id,
    ],
  );
  return c.json({ project: mapProject(result.rows[0]) });
});

projectRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await pool.query(
    `SELECT * FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [id, user.id],
  );
  if (!result.rows[0]) return c.json({ error: "课题不存在" }, 404);
  return c.json({ project: mapProject(result.rows[0]) });
});

/** 硬删除课题：级联方向 / 进度 / 附件元数据；对象存储 best-effort 清理。 */
projectRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const owned = await pool.query(
    `SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [id, user.id],
  );
  if (!owned.rows[0]) return c.json({ error: "课题不存在" }, 404);

  const keys = await attachmentKeysForProject(id);
  await pool.query(`DELETE FROM projects WHERE id = $1`, [id]);
  await deleteObjectsBestEffort(keys);
  return c.json({ ok: true });
});
