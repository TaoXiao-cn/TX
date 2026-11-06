import { Hono } from "hono";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthUser } from "../lib/auth.js";
import {
  collectAttachmentIdsFromEntry,
  toDocx,
  toMarkdown,
  toPdf,
  type ExportAttachment,
  type ExportEntry,
  type ExportProject,
} from "../lib/export.js";
import { assertDirectionOwned } from "./directions.js";

type Vars = { user: AuthUser };

export const exportRoutes = new Hono<{ Variables: Vars }>();

exportRoutes.use("*", requireAuth);

function mapAttachmentRow(a: Record<string, unknown>): ExportAttachment {
  return {
    id: String(a.id),
    fileName: String(a.file_name),
    mimeType: String(a.mime_type),
    storageKey: String(a.storage_key),
  };
}

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

  const mapEntry = (e: Record<string, unknown>): ExportEntry => ({
    id: String(e.id),
    contentHtml: String(e.content_html ?? ""),
    contentJson: e.content_json,
    createdAt: String(e.created_at),
    updatedAt: String(e.updated_at),
    attachments: atts
      .filter((a) => String(a.entry_id) === String(e.id))
      .map((a) => mapAttachmentRow(a)),
  });

  // 先扫 TipTap 正文里的 /api/attachments/:id，补齐未挂在当前条目附件列表里的行
  const draftEntries = entries.rows.map(mapEntry);
  const neededIds = new Set<string>();
  for (const entry of draftEntries) {
    for (const id of collectAttachmentIdsFromEntry(entry)) neededIds.add(id);
  }
  const known = new Set(atts.map((a) => String(a.id)));
  const missing = [...neededIds].filter((id) => !known.has(id));
  if (missing.length) {
    const extra = await pool.query(
      `SELECT a.* FROM attachments a
       JOIN progress_entries e ON e.id = a.entry_id
       JOIN projects p ON p.id = e.project_id
       WHERE a.id = ANY($1::uuid[]) AND p.owner_user_id = $2`,
      [missing, userId],
    );
    atts = atts.concat(extra.rows);
  }

  const attachmentsById: Record<string, ExportAttachment> = {};
  for (const a of atts) {
    const mapped = mapAttachmentRow(a);
    attachmentsById[mapped.id] = mapped;
  }

  return {
    title: project.rows[0].title,
    description: project.rows[0].description,
    attachmentsById,
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
    const md = await toMarkdown(project);
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
