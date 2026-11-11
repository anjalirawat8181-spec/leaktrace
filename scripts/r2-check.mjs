import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutBucketCorsCommand, GetBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET })) {
  if (!v) throw new Error(`${k} is not set`);
}

const origins = (process.env.R2_CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean);
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const key = `healthcheck/${Date.now()}.txt`;
const step = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
let failed = false;
const check = (name, ok, extra) => { step(name, ok, extra); if (!ok) failed = true; };

await client.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
check('bucket exists and keys can access it', true);

if (process.argv.includes('--set-cors')) {
  await client.send(new PutBucketCorsCommand({
    Bucket: R2_BUCKET,
    CORSConfiguration: {
      CORSRules: [{
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'PUT'],
        AllowedHeaders: ['Content-Type'],
        MaxAgeSeconds: 3600,
      }],
    },
  }));
}
const cors = await client.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET })).catch(() => undefined);
const rule = cors?.CORSRules?.[0];
check('CORS rule allows GET and PUT with Content-Type', Boolean(rule?.AllowedMethods?.includes('GET') && rule.AllowedMethods.includes('PUT') && rule.AllowedHeaders?.includes('Content-Type')));
console.log(`      allowed origins: ${(rule?.AllowedOrigins ?? []).join(', ')}`);

await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: 'ok', ContentType: 'text/plain' }));
check('put object', true);

const got = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
check('get object', (await got.Body.transformToString()) === 'ok');

const signedGet = await getSignedUrl(client, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 60 });
const viaSigned = await fetch(signedGet);
check('presigned GET url works', viaSigned.ok && (await viaSigned.text()) === 'ok');

const signedPut = await getSignedUrl(client, new PutObjectCommand({ Bucket: R2_BUCKET, Key: `${key}.put`, ContentType: 'text/plain' }), { expiresIn: 60 });
const putRes = await fetch(signedPut, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'ok2' });
check('presigned PUT url works', putRes.ok);

const anonymous = await fetch(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`);
check('object is private (anonymous request refused)', !anonymous.ok, `status ${anonymous.status}`);

await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: `${key}.put` }));
check('test objects deleted', true);

process.exit(failed ? 1 : 0);
