import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import https from 'https';
import http from 'http';

// Mesmas variáveis de ambiente do backend (ig-posts.service.ts / quiz.service.ts
// / audio-asset.service.ts) — bucket compartilhado, sem credencial nova.
const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

const bucket = process.env.R2_BUCKET ?? 'converthair-ig';
const publicUrlBase = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

export const publicUrlFor = (key) => `${publicUrlBase}/${key}`;

export const uploadFile = async (key, body, contentType, contentDisposition) => {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
  }));
  return { key, url: publicUrlFor(key) };
};

// Todo objeto no bucket já sai com leitura pública (confirmado: nenhum
// PutObjectCommand daqui ou do backend passa ACL, e o GET público funciona
// mesmo assim) — então baixar por URL é mais simples que autenticar de novo,
// e é o mesmo padrão que o resto do projeto usa pra CONSUMIR arquivos do R2.
export const downloadToFile = (url, destPath) => new Promise((resolve, reject) => {
  const client = url.startsWith('http://') ? http : https;
  client.get(url, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      downloadToFile(res.headers.location, destPath).then(resolve, reject);
      return;
    }
    if (res.statusCode !== 200) {
      reject(new Error(`Download falhou (HTTP ${res.statusCode}): ${url}`));
      res.resume();
      return;
    }
    pipeline(res, createWriteStream(destPath)).then(resolve, reject);
  }).on('error', reject);
});
