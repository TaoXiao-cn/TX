import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

export const s3 = new S3Client({
  region: env.s3.region,
  endpoint: env.s3.endpoint,
  forcePathStyle: env.s3.forcePathStyle,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey,
  },
});

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
    } catch (err) {
      console.warn("ensureBucket:", err);
    }
  }
}

export async function putObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
  return publicUrlFor(params.key);
}

export function publicUrlFor(key: string) {
  return `${env.s3.publicUrl.replace(/\/$/, "")}/${key}`;
}

export async function deleteObject(key: string) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
    }),
  );
  const bytes = await res.Body?.transformToByteArray();
  return Buffer.from(bytes ?? []);
}

export async function signedGetUrl(key: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }),
    { expiresIn: 3600 },
  );
}
