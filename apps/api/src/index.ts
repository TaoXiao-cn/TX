import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./lib/env.js";
import { ensureBucket } from "./lib/s3.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { directionRoutes } from "./routes/directions.js";
import { entryRoutes } from "./routes/entries.js";
import { exportRoutes } from "./routes/export.js";
import { pdfFontStatus } from "./lib/export.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.corsOrigin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

const pdfFont = pdfFontStatus();

app.get("/health", (c) => c.json({ ok: true, ...pdfFont }));

app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api", directionRoutes);
app.route("/api", entryRoutes);
app.route("/api", exportRoutes);

await ensureBucket();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
