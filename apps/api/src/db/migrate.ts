import { pool } from "./pool.js";

const DEFAULT_DIRECTION_TITLE = "默认方向";

const sql = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);

CREATE TABLE IF NOT EXISTS directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directions_project ON directions(project_id);

CREATE TABLE IF NOT EXISTS progress_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_html TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entries_project_created
  ON progress_entries(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES progress_entries(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);
`;

async function ensureDirectionColumn() {
  await pool.query(`
    ALTER TABLE progress_entries
    ADD COLUMN IF NOT EXISTS direction_id UUID REFERENCES directions(id) ON DELETE CASCADE
  `);
}

/** 每个课题至少有一个「默认方向」；旧条目挂到该方向。 */
async function migrateEntriesToDirections() {
  const projects = await pool.query(`SELECT id FROM projects`);
  for (const project of projects.rows) {
    const projectId = project.id as string;
    let direction = await pool.query(
      `SELECT id FROM directions
       WHERE project_id = $1 AND title = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [projectId, DEFAULT_DIRECTION_TITLE],
    );
    if (!direction.rows[0]) {
      const any = await pool.query(
        `SELECT id FROM directions
         WHERE project_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [projectId],
      );
      if (any.rows[0]) {
        direction = any;
      } else {
        direction = await pool.query(
          `INSERT INTO directions (project_id, title, description)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [projectId, DEFAULT_DIRECTION_TITLE, "自动创建，用于承接历史进度"],
        );
      }
    }
    const directionId = direction.rows[0].id as string;
    await pool.query(
      `UPDATE progress_entries
       SET direction_id = $1
       WHERE project_id = $2 AND direction_id IS NULL`,
      [directionId, projectId],
    );
  }

  // 无课题的孤立条目不应存在；若有则跳过 NOT NULL
  const orphans = await pool.query(
    `SELECT COUNT(*)::int AS n FROM progress_entries WHERE direction_id IS NULL`,
  );
  if (orphans.rows[0].n === 0) {
    await pool.query(`
      ALTER TABLE progress_entries
      ALTER COLUMN direction_id SET NOT NULL
    `);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_direction_created
    ON progress_entries(direction_id, created_at DESC)
  `);
}

async function main() {
  await pool.query(sql);
  await ensureDirectionColumn();
  await migrateEntriesToDirections();
  console.log("Migrations applied.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
