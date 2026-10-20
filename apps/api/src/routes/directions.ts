import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";

type Vars = { user: AuthUser };

export const directionRoutes = new Hono<{ Variables: Vars }>();

directionRoutes.use("*", requireAuth);

export function mapDirection(row: Record<string, unknown>) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertProjectOwned(projectId: string, userId: string) {
  const result = await pool.query(
    `SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [projectId, userId],
  );
  return Boolean(result.rows[0]);
}

export async function assertDirectionOwned(
  directionId: string,
  userId: string,
) {
  const result = await pool.query(
    `SELECT d.* FROM directions d
     JOIN projects p ON p.id = d.project_id
     WHERE d.id = $1 AND p.owner_user_id = $2`,
    [directionId, userId],
  );
  return result.rows[0] ?? null;
}

directionRoutes.get("/projects/:projectId/directions", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("projectId");
  if (!(await assertProjectOwned(projectId, user.id))) {
    return c.json({ error: "课题不存在" }, 404);
  }

  const status = c.req.query("status") ?? "active";
  const result = await pool.query(
    `SELECT * FROM directions
     WHERE project_id = $1 AND ($2 = 'all' OR status = $2)
     ORDER BY created_at ASC`,
    [projectId, status],
  );
  return c.json({ directions: result.rows.map(mapDirection) });
});

directionRoutes.post("/projects/:projectId/directions", async (c) => {
  const user = c.get("user");
  const projectId = c.req.param("projectId");
  if (!(await assertProjectOwned(projectId, user.id))) {
    return c.json({ error: "课题不存在" }, 404);
  }

  const body = await c.req.json<{ title?: string; description?: string }>();
  const title = body.title?.trim();
  if (!title) return c.json({ error: "方向名称不能为空" }, 400);

  const result = await pool.query(
    `INSERT INTO directions (project_id, title, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [projectId, title, body.description?.trim() ?? ""],
  );
  await pool.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [
    projectId,
  ]);
  return c.json({ direction: mapDirection(result.rows[0]) }, 201);
});

directionRoutes.patch("/directions/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    description?: string;
    status?: "active" | "archived";
  }>();

  const owned = await assertDirectionOwned(id, user.id);
  if (!owned) return c.json({ error: "方向不存在" }, 404);

  const result = await pool.query(
    `UPDATE directions SET
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
  await pool.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [
    owned.project_id,
  ]);
  return c.json({ direction: mapDirection(result.rows[0]) });
});

directionRoutes.get("/directions/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const owned = await assertDirectionOwned(id, user.id);
  if (!owned) return c.json({ error: "方向不存在" }, 404);
  return c.json({ direction: mapDirection(owned) });
});
