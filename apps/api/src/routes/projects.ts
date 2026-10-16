import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";

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

  const result = await pool.query(
    `INSERT INTO projects (owner_user_id, title, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [user.id, title, body.description?.trim() ?? ""],
  );
  return c.json({ project: mapProject(result.rows[0]) }, 201);
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
