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

function formatDay(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function allEntries(project: ExportProject): ExportEntry[] {
  return project.directions.flatMap((d) => d.entries);
}

export function toMarkdown(project: ExportProject): string {
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
      lines.push(stripHtml(entry.contentHtml) || "（空内容）");
      lines.push("");
      if (entry.attachments.length) {
        lines.push("#### 附件");
        for (const a of entry.attachments) {
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

async function loadImageBuffers(project: ExportProject) {
  const map = new Map<string, Buffer>();
  for (const entry of allEntries(project)) {
    for (const a of entry.attachments) {
      if (a.mimeType.startsWith("image/")) {
        try {
          map.set(a.id, await getObjectBuffer(a.storageKey));
        } catch {
          // skip missing images
        }
      }
    }
  }
  return map;
}

function appendEntryDocx(
  children: Paragraph[],
  entry: ExportEntry,
  images: Map<string, Buffer>,
  heading: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_3,
) {
  children.push(
    new Paragraph({
      text: formatDay(entry.createdAt),
      heading,
    }),
  );
  const text = stripHtml(entry.contentHtml) || "（空内容）";
  for (const line of text.split("\n")) {
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  for (const a of entry.attachments) {
    const buf = images.get(a.id);
    if (buf) {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: 480, height: 320 },
              type: a.mimeType.includes("png")
                ? "png"
                : a.mimeType.includes("gif")
                  ? "gif"
                  : "jpg",
            }),
          ],
        }),
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `附件：${a.fileName}`, italics: true }),
          ],
        }),
      );
    }
  }
}

export async function toDocx(project: ExportProject): Promise<Buffer> {
  const images = await loadImageBuffers(project);
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
      appendEntryDocx(children, entry, images);
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function toPdf(project: ExportProject): Promise<Buffer> {
  const cjkFont = resolveCjkFont();
  const images = await loadImageBuffers(project);

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
        useFont(13);
        doc.fillColor("#1677ff").text(formatDay(entry.createdAt));
        doc.fillColor("#000");
        doc.moveDown(0.3);
        useFont(11);
        doc.text(stripHtml(entry.contentHtml) || "（空内容）", {
          align: "left",
        });
        doc.moveDown(0.5);

        for (const a of entry.attachments) {
          const buf = images.get(a.id);
          if (buf) {
            try {
              doc.image(buf, { fit: [480, 320] });
              doc.moveDown(0.5);
            } catch {
              useFont(10);
              doc.fillColor("#666").text(`附件：${a.fileName}`);
              doc.fillColor("#000");
            }
          } else {
            useFont(10);
            doc.fillColor("#666").text(`附件：${a.fileName}`);
            doc.fillColor("#000");
          }
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
