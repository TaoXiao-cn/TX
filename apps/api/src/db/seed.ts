import bcrypt from "bcryptjs";
import { pool } from "./pool.js";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo123456";

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [DEMO_EMAIL, hash, "演示用户"],
  );
  const userId = user.rows[0].id as string;

  const existing = await pool.query(
    `SELECT id FROM projects WHERE owner_user_id = $1 AND title = $2`,
    [userId, "示例课题：光合作用机制"],
  );

  let projectId: string;
  if (existing.rows[0]) {
    projectId = existing.rows[0].id;
  } else {
    const project = await pool.query(
      `INSERT INTO projects (owner_user_id, title, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, "示例课题：光合作用机制", "用于验收的演示课题"],
    );
    projectId = project.rows[0].id;

    const direction = await pool.query(
      `INSERT INTO directions (project_id, title, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [projectId, "默认方向", "演示用子课题方向"],
    );
    const directionId = direction.rows[0].id as string;

    await pool.query(
      `INSERT INTO progress_entries (project_id, direction_id, content_json, content_html)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        projectId,
        directionId,
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "今天完成了文献综述初稿，并整理了实验假设。",
                },
              ],
            },
          ],
        }),
        "<p>今天完成了文献综述初稿，并整理了实验假设。</p>",
      ],
    );
  }

  console.log("Seed complete.");
  console.log(`Demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Demo project id: ${projectId}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
