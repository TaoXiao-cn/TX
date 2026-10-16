import { Hono } from "hono";
import { pool } from "../db/pool.js";
import {
  hashPassword,
  requireAuth,
  signToken,
  verifyPassword,
  type AuthUser,
} from "../lib/auth.js";

type Vars = { user: AuthUser };

export const authRoutes = new Hono<{ Variables: Vars }>();

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<{
    email?: string;
    password?: string;
    displayName?: string;
  }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const displayName = body.displayName?.trim() || email?.split("@")[0] || "用户";

  if (!email || !password || password.length < 6) {
    return c.json({ error: "请提供有效邮箱，密码至少 6 位" }, 400);
  }

  const exists = await pool.query(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  if (exists.rows[0]) {
    return c.json({ error: "该邮箱已注册" }, 409);
  }

  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name`,
    [email, passwordHash, displayName],
  );
  const row = result.rows[0];
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
  const token = await signToken(user);
  return c.json({ token, user });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return c.json({ error: "请输入邮箱和密码" }, 400);
  }

  const result = await pool.query(
    `SELECT id, email, display_name, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = result.rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return c.json({ error: "邮箱或密码错误" }, 401);
  }

  const user: AuthUser = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  };
  const token = await signToken(user);
  return c.json({ token, user });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ user: c.get("user") });
});
