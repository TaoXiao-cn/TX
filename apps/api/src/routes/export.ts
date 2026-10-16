import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";
import {
  toDocx,
  toMarkdown,
  toPdf,
  type ExportProject,
} from "../lib/export.js";

type Vars = { user: AuthUser };

export const exportRoutes = new Hono<{ Variables: Vars }>();

exportRoutes.use("*", requireAuth);

async function loadProject(
  projectId: string,
  userId: string,
): Promise<ExportProject | null> {
  const project = await pool.query(
    `SELECT * FROM projects WHERE id = $1 AND owner_user_id = $2`,
    [projectId, userId],
  );
  if (!project.rows[0]) return null;

  const entries = await pool.query(
    `SELECT * FROM progress_entries
     WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId],
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

  return {
    title: project.rows[0].title,
    description: project.rows[0].description,
    entries: entries.rows.map((e) => ({
      id: e.id,
      contentHtml: e.content_html,
      contentJson: e.content_json,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
      attachments: atts
        .filter((a) => a.entry_id === e.id)
        .map((a) => ({
          id: String(a.id),
          fileName: String(a.file_name),
          mimeType: String(a.mime_type),
          storageKey: String(a.storage_key),
        })),
    })),
  };
}

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "project";
}

exportRoutes.get("/projects/:id/export/:format", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const format = c.req.param("format");
  const project = await loadProject(id, user.id);
  if (!project) return c.json({ error: "课题不存在" }, 404);

  const base = safeName(project.title);

  if (format === "md") {
    const md = toMarkdown(project);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}.md"`,
      },
    });
  }

  if (format === "docx") {
    const buf = await toDocx(project);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}.docx"`,
      },
    });
  }

  if (format === "pdf") {
    const buf = await toPdf(project);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(base)}.pdf"`,
      },
    });
  }

  return c.json({ error: "不支持的导出格式" }, 400);
});
