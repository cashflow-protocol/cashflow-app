import 'dotenv/config';
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

async function main() {
  const key = process.env.DO_SPACES_KEY;
  const secret = process.env.DO_SPACES_SECRET;
  const endpoint = process.env.DO_SPACES_ENDPOINT;
  const region = process.env.DO_SPACES_REGION || 'nyc3';
  const bucket = process.env.DO_SPACES_BUCKET || 'cashflow-uploads';

  if (!key || !secret || !endpoint) {
    console.error('DO_SPACES_KEY / DO_SPACES_SECRET / DO_SPACES_ENDPOINT must be set');
    process.exit(1);
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: false,
  });

  console.log(`Setting CORS on bucket: ${bucket} (${endpoint})`);

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );

  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log('CORS rules now in place:');
  console.log(JSON.stringify(current.CORSRules, null, 2));
}

main().catch((err) => {
  console.error('setupSpacesCors failed:', err);
  process.exit(1);
});
