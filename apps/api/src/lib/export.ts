import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
} from "docx";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import { getObjectBuffer } from "./s3.js";

// Noto Sans SC Regular（由 2.004 可变字体实例到 wght=400 的 TrueType，SIL OFL）。
// 必须是 TTF：pdfkit 把 OTF/CFF 嵌成 CIDFontType0，Chrome / Safari / macOS 预览
// 不认这种子集，会退回标准字体，中文看起来仍是乱码。Helvetica 是 WinAnsi，同样不能用。
const CJK_FONT_FILE = "NotoSansSC-Regular.ttf";

function cjkFontCandidates() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, "../../assets/fonts", CJK_FONT_FILE),
    path.resolve(here, "../fonts", CJK_FONT_FILE),
    path.join("/usr/local/share/fonts", CJK_FONT_FILE),
  ];
}

function resolveCjkFont() {
  const found = cjkFontCandidates().find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `缺少中文字体 ${CJK_FONT_FILE}（已查找 ${cjkFontCandidates().join(" , ")}）。PDF 必须嵌入 TrueType CJK，不能使用 Helvetica 或 OTF。`,
    );
  }
  return found;
}

export function pdfFontStatus() {
  const file = resolveCjkFont();
  const magic = readFileSync(file).subarray(0, 4);
  // TrueType 轮廓：00 01 00 00。OTTO 是 CFF/OTF，阅读器会画乱。
  if (!magic.equals(Buffer.from([0x00, 0x01, 0x00, 0x00]))) {
    throw new Error(
      `中文字体必须是 TrueType，当前 ${file} magic=${magic.toString("hex")}`,
    );
  }
  return { pdfFont: "NotoSansSC-Regular", pdfFontFormat: "truetype" as const };
}

function assertEmbeddedCjk(pdf: Buffer) {
  const bad =
    pdf.includes(Buffer.from("WinAnsiEncoding")) ||
    pdf.includes(Buffer.from("/Helvetica")) ||
    pdf.includes(Buffer.from("CIDFontType0"));
  const ok =
    pdf.includes(Buffer.from("NotoSansSC")) &&
    pdf.includes(Buffer.from("CIDFontType2"));
  if (bad || !ok) {
    throw new Error(
      "PDF 未以 TrueType（CIDFontType2）嵌入 Noto Sans SC，拒绝返回会乱码的文件",
    );
  }
}

export type ExportAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  storageKey: string;
};

export type ExportEntry = {
  id: string;
  contentHtml: string;
  contentJson: unknown;
  createdAt: string;
  updatedAt: string;
  attachments: ExportAttachment[];
};

export type ExportDirection = {
  title: string;
  entries: ExportEntry[];
};

export type ExportProject = {
  title: string;
  description: string;
  directions: ExportDirection[];
  /**
   * 课题下全部附件索引。TipTap 正文里的 `/api/attachments/:id/file`
   * （含 ?token=）靠它查 storageKey，再读对象存储，不走需登录的 HTTP。
   */
  attachmentsById?: Record<string, ExportAttachment>;
  /** 测试可注入；默认读 S3/本地对象存储。 */
  fetchAttachmentBuffer?: (att: ExportAttachment) => Promise<Buffer>;
};

type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string };

export type ResolvedImage = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  attachmentId?: string;
  /** 适合 Markdown 引用的相对路径（附件图） */
  mdSrc?: string;
};

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 从正文 HTML 拆出文本块与 <img>，保留出现顺序（TipTap 内嵌图）。 */
export function parseContentBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const re =
    /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const before = stripHtml(html.slice(last, match.index));
    if (before) blocks.push({ kind: "text", text: before });
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const src = decodeHtmlEntities(raw).trim();
    if (src) blocks.push({ kind: "image", src });
    last = match.index + match[0].length;
  }
  const rest = stripHtml(html.slice(last));
  if (rest) blocks.push({ kind: "text", text: rest });
  return blocks;
}

/** 从 TipTap JSON 收集 image 节点的 src。 */
export function collectImageSrcsFromJson(node: unknown, out: string[] = []) {
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  if (record.type === "image") {
    const attrs = record.attrs as Record<string, unknown> | undefined;
    const src = attrs?.src;
    if (typeof src === "string" && src.trim()) out.push(src.trim());
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const child of content) collectImageSrcsFromJson(child, out);
  }
  return out;
}

export function parseDataUrl(src: string): ResolvedImage | null {
  const match =
    /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i.exec(
      src.trim(),
    );
  if (!match) return null;
  try {
    const mimeType = (match[1] || "image/png").toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!buffer.length) return null;
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

/** 解析 `/api/attachments/:uuid/file`（可带绝对域名与 ?token=）。 */
export function attachmentIdFromSrc(src: string): string | null {
  const match =
    /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/file)?(?:\?|#|$)/i.exec(
      src,
    );
  return match?.[1] ?? null;
}

export function collectAttachmentIdsFromEntry(entry: ExportEntry): string[] {
  const ids = new Set<string>();
  for (const block of parseContentBlocks(entry.contentHtml)) {
    if (block.kind !== "image") continue;
    const id = attachmentIdFromSrc(block.src);
    if (id) ids.add(id);
  }
  for (const src of collectImageSrcsFromJson(entry.contentJson)) {
    const id = attachmentIdFromSrc(src);
    if (id) ids.add(id);
  }
  for (const a of entry.attachments) ids.add(a.id);
  return [...ids];
}

function docxImageType(mime: string): "png" | "jpg" | "gif" | null {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  return null;
}

function pdfSupportsImage(mime: string) {
  const m = mime.toLowerCase();
  return m.includes("png") || m.includes("jpeg") || m.includes("jpg");
}

function imagePlaceholder(fileName?: string) {
  return fileName ? `（图片无法嵌入：${fileName}）` : "（图片无法嵌入）";
}

function attachmentIndex(project: ExportProject): Record<string, ExportAttachment> {
  if (project.attachmentsById) return project.attachmentsById;
  const map: Record<string, ExportAttachment> = {};
  for (const direction of project.directions) {
    for (const entry of direction.entries) {
      for (const a of entry.attachments) map[a.id] = a;
    }
  }
  return map;
}

async function readAttachmentBuffer(
  project: ExportProject,
  att: ExportAttachment,
): Promise<Buffer> {
  if (project.fetchAttachmentBuffer) {
    return project.fetchAttachmentBuffer(att);
  }
  return getObjectBuffer(att.storageKey);
}

async function resolveImageSrc(
  project: ExportProject,
  src: string,
  cache: Map<string, ResolvedImage | null>,
): Promise<ResolvedImage | null> {
  if (cache.has(src)) return cache.get(src) ?? null;

  let resolved: ResolvedImage | null = null;
  if (/^data:/i.test(src)) {
    resolved = parseDataUrl(src);
  } else {
    const id = attachmentIdFromSrc(src);
    const index = attachmentIndex(project);
    const att = id
      ? index[id]
      : Object.values(index).find(
          (a) => a.storageKey && src.includes(a.storageKey),
        );
    if (att?.mimeType.startsWith("image/")) {
      try {
        resolved = {
          buffer: await readAttachmentBuffer(project, att),
          mimeType: att.mimeType,
          fileName: att.fileName,
          attachmentId: att.id,
          mdSrc: `/api/attachments/${att.id}/file`,
        };
      } catch {
        resolved = null;
      }
    }
  }

  cache.set(src, resolved);
  return resolved;
}

type PreparedEntry = {
  blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "image"; src: string; image: ResolvedImage | null }
  >;
  /** 附件卡片上的图片，且未作为 TipTap 正文节点出现过 */
  extraImages: ResolvedImage[];
  otherAttachments: ExportAttachment[];
};

async function prepareEntry(
  project: ExportProject,
  entry: ExportEntry,
): Promise<PreparedEntry> {
  const cache = new Map<string, ResolvedImage | null>();
  const blocks = parseContentBlocks(entry.contentHtml);
  const htmlSrcs = new Set(
    blocks.filter((b) => b.kind === "image").map((b) => b.src),
  );

  for (const src of collectImageSrcsFromJson(entry.contentJson)) {
    if (!htmlSrcs.has(src)) {
      blocks.push({ kind: "image", src });
      htmlSrcs.add(src);
    }
  }

  const preparedBlocks: PreparedEntry["blocks"] = [];
  const usedAttachmentIds = new Set<string>();

  for (const block of blocks) {
    if (block.kind === "text") {
      preparedBlocks.push(block);
      continue;
    }
    const image = await resolveImageSrc(project, block.src, cache);
    if (image?.attachmentId) usedAttachmentIds.add(image.attachmentId);
    preparedBlocks.push({ kind: "image", src: block.src, image });
  }

  const extraImages: ResolvedImage[] = [];
  const otherAttachments: ExportAttachment[] = [];

  for (const a of entry.attachments) {
    if (usedAttachmentIds.has(a.id)) continue;
    if (a.mimeType.startsWith("image/")) {
      try {
        extraImages.push({
          buffer: await readAttachmentBuffer(project, a),
          mimeType: a.mimeType,
          fileName: a.fileName,
          attachmentId: a.id,
          mdSrc: `/api/attachments/${a.id}/file`,
        });
      } catch {
        otherAttachments.push(a);
      }
    } else {
      otherAttachments.push(a);
    }
  }

  return { blocks: preparedBlocks, extraImages, otherAttachments };
}

function entryHasVisualContent(prepared: PreparedEntry) {
  if (prepared.extraImages.length || prepared.otherAttachments.length) {
    return true;
  }
  return prepared.blocks.some((b) =>
    b.kind === "text" ? Boolean(b.text) : true,
  );
}

function markdownForImage(image: ResolvedImage | null, srcHint?: string) {
  if (image?.mdSrc) {
    const alt = image.fileName || "图片";
    return `![${alt}](${image.mdSrc})`;
  }
  if (image) {
    const alt = image.fileName || "图片";
    return `![${alt}](data:${image.mimeType};base64,${image.buffer.toString("base64")})`;
  }
  const id = srcHint ? attachmentIdFromSrc(srcHint) : null;
  if (id) return `![图片](/api/attachments/${id}/file)`;
  if (srcHint && !/^data:/i.test(srcHint)) return `![图片](${srcHint})`;
  return imagePlaceholder();
}

/** Markdown：附件图写成 `/api/attachments/:id/file`；data URL 内嵌。 */
export async function toMarkdown(project: ExportProject): Promise<string> {
  const lines: string[] = [
    `# ${project.title}`,
    "",
    project.description ? `${project.description}\n` : "",
    "---",
    "",
  ];

  for (const direction of project.directions) {
    lines.push(`## ${direction.title}`);
    lines.push("");
    if (direction.entries.length === 0) {
      lines.push("（暂无进度）");
      lines.push("");
      lines.push("---");
      lines.push("");
      continue;
    }
    for (const entry of direction.entries) {
      lines.push(`### ${formatDay(entry.createdAt)}`);
      lines.push("");
      const prepared = await prepareEntry(project, entry);
      if (!entryHasVisualContent(prepared)) {
        lines.push("（空内容）");
        lines.push("");
      } else {
        for (const block of prepared.blocks) {
          if (block.kind === "text") {
            lines.push(block.text);
            lines.push("");
          } else {
            lines.push(markdownForImage(block.image, block.src));
            lines.push("");
          }
        }
        for (const image of prepared.extraImages) {
          lines.push(markdownForImage(image));
          lines.push("");
        }
      }
      if (prepared.otherAttachments.length) {
        lines.push("#### 附件");
        for (const a of prepared.otherAttachments) {
          lines.push(`- ${a.fileName} (${a.mimeType})`);
        }
        lines.push("");
      }
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function pushDocxImage(
  children: Paragraph[],
  image: ResolvedImage | null,
  fallbackName?: string,
) {
  if (!image) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: imagePlaceholder(fallbackName),
            italics: true,
          }),
        ],
      }),
    );
    return;
  }
  const type = docxImageType(image.mimeType);
  if (!type) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: imagePlaceholder(image.fileName || fallbackName),
            italics: true,
          }),
        ],
      }),
    );
    return;
  }
  children.push(
    new Paragraph({
      children: [
        new ImageRun({
          data: image.buffer,
          transformation: { width: 480, height: 320 },
          type,
        }),
      ],
    }),
  );
}

function appendEntryDocx(
  children: Paragraph[],
  prepared: PreparedEntry,
  createdAt: string,
) {
  children.push(
    new Paragraph({
      text: formatDay(createdAt),
      heading: HeadingLevel.HEADING_3,
    }),
  );

  if (!entryHasVisualContent(prepared)) {
    children.push(
      new Paragraph({ children: [new TextRun("（空内容）")] }),
    );
  } else {
    for (const block of prepared.blocks) {
      if (block.kind === "text") {
        for (const line of block.text.split("\n")) {
          children.push(new Paragraph({ children: [new TextRun(line)] }));
        }
      } else {
        pushDocxImage(children, block.image);
      }
    }
    for (const image of prepared.extraImages) {
      pushDocxImage(children, image, image.fileName);
    }
  }

  for (const a of prepared.otherAttachments) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `附件：${a.fileName}`, italics: true }),
        ],
      }),
    );
  }
}

export async function toDocx(project: ExportProject): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      text: project.title,
      heading: HeadingLevel.TITLE,
    }),
  ];

  if (project.description) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: project.description, italics: true })],
      }),
    );
  }

  for (const direction of project.directions) {
    children.push(
      new Paragraph({
        text: direction.title,
        heading: HeadingLevel.HEADING_1,
      }),
    );
    if (direction.entries.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "（暂无进度）", italics: true })],
        }),
      );
      continue;
    }
    for (const entry of direction.entries) {
      appendEntryDocx(
        children,
        await prepareEntry(project, entry),
        entry.createdAt,
      );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

function drawPdfImage(
  doc: PDFKit.PDFDocument,
  useFont: (size: number) => void,
  image: ResolvedImage | null,
  fallbackName?: string,
) {
  if (!image) {
    useFont(10);
    doc.fillColor("#666").text(imagePlaceholder(fallbackName));
    doc.fillColor("#000");
    return;
  }
  if (!pdfSupportsImage(image.mimeType)) {
    useFont(10);
    doc
      .fillColor("#666")
      .text(imagePlaceholder(image.fileName || fallbackName));
    doc.fillColor("#000");
    return;
  }
  try {
    doc.image(image.buffer, { fit: [480, 320] });
    doc.moveDown(0.5);
  } catch {
    useFont(10);
    doc
      .fillColor("#666")
      .text(imagePlaceholder(image.fileName || fallbackName));
    doc.fillColor("#000");
  }
}

export async function toPdf(project: ExportProject): Promise<Buffer> {
  const cjkFont = resolveCjkFont();
  const preparedByEntry = new Map<string, PreparedEntry>();
  for (const direction of project.directions) {
    for (const entry of direction.entries) {
      preparedByEntry.set(entry.id, await prepareEntry(project, entry));
    }
  }

  const pdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", font: cjkFont });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("NotoSansSC", cjkFont);
    const useFont = (size: number) => {
      doc.font("NotoSansSC").fontSize(size);
    };

    useFont(20);
    doc.text(project.title, { align: "left" });
    doc.moveDown(0.5);
    if (project.description) {
      useFont(11);
      doc.fillColor("#555").text(project.description);
      doc.fillColor("#000");
      doc.moveDown();
    }

    for (const direction of project.directions) {
      useFont(16);
      doc.fillColor("#1f6f5b").text(direction.title);
      doc.fillColor("#000");
      doc.moveDown(0.4);

      if (direction.entries.length === 0) {
        useFont(11);
        doc.fillColor("#666").text("（暂无进度）");
        doc.fillColor("#000");
        doc.moveDown();
        continue;
      }

      for (const entry of direction.entries) {
        const prepared = preparedByEntry.get(entry.id)!;
        useFont(13);
        doc.fillColor("#1677ff").text(formatDay(entry.createdAt));
        doc.fillColor("#000");
        doc.moveDown(0.3);

        if (!entryHasVisualContent(prepared)) {
          useFont(11);
          doc.text("（空内容）", { align: "left" });
        } else {
          for (const block of prepared.blocks) {
            if (block.kind === "text") {
              useFont(11);
              doc.text(block.text, { align: "left" });
              doc.moveDown(0.3);
            } else {
              drawPdfImage(doc, useFont, block.image);
            }
          }
          for (const image of prepared.extraImages) {
            drawPdfImage(doc, useFont, image, image.fileName);
          }
        }

        for (const a of prepared.otherAttachments) {
          useFont(10);
          doc.fillColor("#666").text(`附件：${a.fileName}`);
          doc.fillColor("#000");
        }

        doc.moveDown();
        doc
          .strokeColor("#dddddd")
          .moveTo(50, doc.y)
          .lineTo(545, doc.y)
          .stroke();
        doc.moveDown();
      }
    }

    doc.end();
  });
  assertEmbeddedCjk(pdf);
  return pdf;
}
