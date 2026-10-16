import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://progress:progress@localhost:5432/progress",
  ),
  jwtSecret: required("JWT_SECRET", "dev-only-change-me"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  s3: {
    endpoint: required("S3_ENDPOINT", "http://localhost:9000"),
    region: process.env.S3_REGION ?? "us-east-1",
    accessKeyId: required("S3_ACCESS_KEY_ID", "minioadmin"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY", "minioadmin"),
    bucket: required("S3_BUCKET", "attachments"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    publicUrl:
      process.env.S3_PUBLIC_URL ?? "http://localhost:9000/attachments",
  },
};
