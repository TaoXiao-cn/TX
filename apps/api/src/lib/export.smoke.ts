/**
 * 导出内嵌图烟雾测试（无测试框架）：
 *   npx tsx src/lib/export.smoke.ts
 * 或：npm run smoke:export -w @project-progress/api
 */
import assert from "node:assert/strict";
import {
  attachmentIdFromSrc,
  parseContentBlocks,
  parseDataUrl,
  toDocx,
  toMarkdown,
  toPdf,
  type ExportAttachment,
  type ExportProject,
} from "./export.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAADAAEABf7U7wAAAABJRU5ErkJggg==",
  "base64",
);

const ATT_ID = "11111111-1111-4111-8111-111111111111";

function sampleProject(over: Partial<ExportProject> = {}): ExportProject {
  const att: ExportAttachment = {
    id: ATT_ID,
    fileName: "shot.png",
    mimeType: "image/png",
    storageKey: `entries/e1/${ATT_ID}-shot.png`,
  };
  return {
    title: "导出图片烟雾",
    description: "验证 TipTap 正文图",
    attachmentsById: { [ATT_ID]: att },
    fetchAttachmentBuffer: async () => PNG_1X1,
    directions: [
      {
        title: "方向 A",
        entries: [
          {
            id: "e1",
            createdAt: "2026-11-06T00:00:00.000Z",
            updatedAt: "2026-11-06T00:00:00.000Z",
            contentHtml: `<p>前文</p><img src="/api/attachments/${ATT_ID}/file?token=abc"><p>后文</p>`,
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "image",
                  attrs: {
                    src: `/api/attachments/${ATT_ID}/file?token=abc`,
                  },
                },
              ],
            },
            attachments: [],
          },
          {
            id: "e2",
            createdAt: "2026-11-06T01:00:00.000Z",
            updatedAt: "2026-11-06T01:00:00.000Z",
            contentHtml: `<p>base64</p><img src="data:image/png;base64,${PNG_1X1.toString("base64")}">`,
            contentJson: {},
            attachments: [],
          },
        ],
      },
    ],
    ...over,
  };
}

assert.equal(
  attachmentIdFromSrc(
    `http://47.117.158.117:8080/api/attachments/${ATT_ID}/file?token=x`,
  ),
  ATT_ID,
);

const blocks = parseContentBlocks(
  `<p>a</p><img src="/api/attachments/${ATT_ID}/file"><p>b</p>`,
);
assert.equal(blocks.length, 3);
assert.equal(blocks[1]?.kind, "image");

assert.ok(parseDataUrl(`data:image/png;base64,${PNG_1X1.toString("base64")}`));

const project = sampleProject();

const md = await toMarkdown(project);
assert.match(md, new RegExp(`/api/attachments/${ATT_ID}/file`));
assert.match(md, /data:image\/png;base64,/);
assert.doesNotMatch(md, /（空内容）/);

const docx = await toDocx(project);
assert.ok(docx.length > 1000);
// DOCX 是 zip，内嵌图会出现在 word/media/
assert.equal(docx.subarray(0, 2).toString("utf8"), "PK");
assert.ok(
  docx.includes(Buffer.from("word/media/")) || docx.includes(PNG_1X1.subarray(0, 8)),
  "DOCX should embed image media",
);

const pdf = await toPdf(project);
assert.ok(pdf.subarray(0, 4).toString("utf8") === "%PDF");
assert.ok(
  pdf.includes(Buffer.from("/Image")) || pdf.includes(Buffer.from("image")),
  "PDF should contain an image XObject",
);
assert.ok(pdf.includes(Buffer.from("NotoSansSC")));

console.log("export.smoke: ok (md/docx/pdf TipTap images)");
