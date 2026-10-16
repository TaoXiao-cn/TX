import pg from "pg";
import { env } from "../lib/env.js";

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
});
