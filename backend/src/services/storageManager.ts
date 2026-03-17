import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

function getClient(): S3Client | null {
  const key = process.env.DO_SPACES_KEY;
  const secret = process.env.DO_SPACES_SECRET;
  const endpoint = process.env.DO_SPACES_ENDPOINT;
  const region = process.env.DO_SPACES_REGION || 'nyc3';

  if (!key || !secret || !endpoint) return null;

  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });
}

function getBucket(): string {
  return process.env.DO_SPACES_BUCKET || 'cashflow-uploads';
}

function getCdnBase(): string {
  const bucket = getBucket();
  const region = process.env.DO_SPACES_REGION || 'nyc3';
  return process.env.DO_SPACES_CDN_URL || `https://${bucket}.${region}.digitaloceanspaces.com`;
}

export function isConfigured(): boolean {
  return !!process.env.DO_SPACES_KEY && !!process.env.DO_SPACES_SECRET && !!process.env.DO_SPACES_ENDPOINT;
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('Storage is not configured');

  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    }),
  );

  return `${getCdnBase()}/${key}`;
}

export async function deleteFile(key: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
  );
}
