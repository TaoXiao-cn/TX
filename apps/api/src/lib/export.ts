import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
} from "docx";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { getObjectBuffer } from "./s3.js";

const CJK_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/PingFang.ttc",
  "C:\\Windows\\Fonts\\msyh.ttc",
];

function resolveCjkFont() {
  return CJK_FONT_CANDIDATES.find((p) => existsSync(p));
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

export type ExportProject = {
  title: string;
  description: string;
  entries: ExportEntry[];
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

export function toMarkdown(project: ExportProject): string {
  const lines: string[] = [
    `# ${project.title}`,
    "",
    project.description ? `${project.description}\n` : "",
    "---",
    "",
  ];

  for (const entry of project.entries) {
    lines.push(`## ${formatDay(entry.createdAt)}`);
    lines.push("");
    lines.push(stripHtml(entry.contentHtml) || "（空内容）");
    lines.push("");
    if (entry.attachments.length) {
      lines.push("### 附件");
      for (const a of entry.attachments) {
        lines.push(`- ${a.fileName} (${a.mimeType})`);
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

async function loadImageBuffers(project: ExportProject) {
  const map = new Map<string, Buffer>();
  for (const entry of project.entries) {
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

  for (const entry of project.entries) {
    children.push(
      new Paragraph({
        text: formatDay(entry.createdAt),
        heading: HeadingLevel.HEADING_2,
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

  const doc = new Document({
    sections: [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function toPdf(project: ExportProject): Promise<Buffer> {
  const images = await loadImageBuffers(project);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cjkFont = resolveCjkFont();
    const useFont = (size: number) => {
      if (cjkFont) {
        try {
          doc.font(cjkFont).fontSize(size);
          return;
        } catch {
          // fall through
        }
      }
      doc.font("Helvetica").fontSize(size);
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

    for (const entry of project.entries) {
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

    doc.end();
  });
}
