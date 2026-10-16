import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Context, Next } from "hono";
import { env } from "./env.js";

const secret = new TextEncoder().encode(env.jwtSecret);

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(user: AuthUser) {
  return new SignJWT({
    email: user.email,
    displayName: user.displayName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret);
  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("Invalid token");
  }
  return {
    id: payload.sub,
    email: payload.email,
    displayName:
      typeof payload.displayName === "string" ? payload.displayName : "",
  };
}

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "未登录" }, 401);
  }
  try {
    const user = await verifyToken(header.slice(7));
    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "登录已失效" }, 401);
  }
}
