import { Readable } from "node:stream";
import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// R2_ENDPOINT is an internal override for local testing against an
// S3-compatible emulator; production always derives it from R2_ACCOUNT_ID.
function getEndpoint(): string {
  return process.env.R2_ENDPOINT ?? `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: getEndpoint(),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

const PRESIGN_EXPIRES_SECONDS = 60 * 60; // 1 hour

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: requireEnv("R2_BUCKET"),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn: PRESIGN_EXPIRES_SECONDS });
}

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: requireEnv("R2_BUCKET"), Key: key }),
  );
  return result.Body as Readable;
}

export function getPublicUrl(key: string): string {
  const base = requireEnv("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  return `${base}/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: requireEnv("R2_BUCKET"), Key: key }),
  );
}

// S3-compatible batch delete, chunked at 1000 keys per request (the API's
// hard limit). Missing keys are not treated as errors.
export async function deleteObjects(keys: string[]): Promise<void> {
  const bucket = requireEnv("R2_BUCKET");
  const client = getClient();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (chunk.length === 0) continue;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      }),
    );
  }
}
