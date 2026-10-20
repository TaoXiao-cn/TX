import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";
import {
  toDocx,
  toMarkdown,
  toPdf,
  type ExportProject,
} from "../lib/export.js";
import { assertDirectionOwned } from "./directions.js";

type Vars = { user: AuthUser };

export const exportRoutes = new Hono<{ Variables: Vars }>();

exportRoutes.use("*", requireAuth);

async function loadProjectExport(
  projectId: string,
  userId: string,
  directionId?: string,
): Promise<ExportProject | null> {
  const project = await pool.query(
    `SELECT * FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [projectId, userId],
  );
  if (!project.rows[0]) return null;

  const directions = await pool.query(
    directionId
      ? `SELECT * FROM directions
         WHERE project_id = $1 AND id = $2
         ORDER BY created_at ASC`
      : `SELECT * FROM directions
         WHERE project_id = $1
         ORDER BY created_at ASC`,
    directionId ? [projectId, directionId] : [projectId],
  );

  const entries = await pool.query(
    directionId
      ? `SELECT * FROM progress_entries
         WHERE project_id = $1 AND direction_id = $2
         ORDER BY created_at ASC`
      : `SELECT * FROM progress_entries
         WHERE project_id = $1
         ORDER BY created_at ASC`,
    directionId ? [projectId, directionId] : [projectId],
  );
  const ids = entries.rows.map((r) => r.id);
  let atts: Record<string, unknown>[] = [];
  if (ids.length) {
    const res = await pool.query(
      `SELECT * FROM attachments WHERE entry_id = ANY($1::uuid[])`,
      [ids],
    );
    atts = res.rows;
  }

  const mapEntry = (e: Record<string, unknown>) => ({
    id: String(e.id),
    contentHtml: String(e.content_html),
    contentJson: e.content_json,
    createdAt: String(e.created_at),
    updatedAt: String(e.updated_at),
    attachments: atts
      .filter((a) => a.entry_id === e.id)
      .map((a) => ({
        id: String(a.id),
        fileName: String(a.file_name),
        mimeType: String(a.mime_type),
        storageKey: String(a.storage_key),
      })),
  });

  return {
    title: project.rows[0].title,
    description: project.rows[0].description,
    directions: directions.rows.map((d) => ({
      title: String(d.title),
      entries: entries.rows
        .filter((e) => e.direction_id === d.id)
        .map(mapEntry),
    })),
  };
}

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "project";
}

async function buildExportResponse(
  project: ExportProject,
  format: string,
  fileBase: string,
): Promise<Response | { error: string; status: 400 }> {
  if (format === "md") {
    const md = toMarkdown(project);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileBase)}.md"`,
      },
    });
  }

  if (format === "docx") {
    const buf = await toDocx(project);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileBase)}.docx"`,
      },
    });
  }

  if (format === "pdf") {
    const buf = await toPdf(project);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileBase)}.pdf"`,
      },
    });
  }

  return { error: "不支持的导出格式", status: 400 };
}

exportRoutes.get("/projects/:id/export/:format", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const format = c.req.param("format");
  const project = await loadProjectExport(id, user.id);
  if (!project) return c.json({ error: "课题不存在" }, 404);

  const result = await buildExportResponse(
    project,
    format,
    safeName(project.title),
  );
  if (!(result instanceof Response)) {
    return c.json({ error: result.error }, result.status);
  }
  return result;
});

exportRoutes.get("/directions/:id/export/:format", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const format = c.req.param("format");
  const direction = await assertDirectionOwned(id, user.id);
  if (!direction) return c.json({ error: "方向不存在" }, 404);

  const project = await loadProjectExport(
    String(direction.project_id),
    user.id,
    id,
  );
  if (!project) return c.json({ error: "课题不存在" }, 404);

  const base = `${safeName(project.title)}_${safeName(String(direction.title))}`;
  const result = await buildExportResponse(project, format, base);
  if (!(result instanceof Response)) {
    return c.json({ error: result.error }, result.status);
  }
  return result;
});
