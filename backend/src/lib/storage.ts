import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compressVideo, probeDurationMs, videoPoster } from './ffmpeg';
import { env } from '../config/env';
import { HttpError } from './errors';

// Media is addressed by *storage key* (e.g. "chat/2026/11/ab12….jpg"). DB columns named *Url hold that key (or an
// absolute http(s) URL for external/seed assets). toUrl() turns a key into a time-limited signed URL, so private media
// is never publicly guessable. Local driver: HMAC-signed /media/<key>?exp&sig. S3 driver: presigned GET.

const root = path.resolve(env.UPLOAD_DIR);
const secret = env.JWT_ACCESS_SECRET + ':media';
const sign = (key: string, exp: number) => crypto.createHmac('sha256', secret).update(`${key}.${exp}`).digest('base64url').slice(0, 32);

let s3: any = null;
async function s3Client() {
  if (s3) return s3;
  const { S3Client } = await import('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } : undefined,
  });
  return s3;
}

export type Kind = 'image' | 'video' | 'voice' | 'document' | 'gif';

// ── content sniffing: never trust the client-declared MIME type ─────────────
const startsWith = (b: Buffer, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);
export function sniff(b: Buffer): { mime: string; ext: string; family: 'image' | 'video' | 'audio' | 'document' } | null {
  if (b.length < 12) return null;
  if (startsWith(b, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg', family: 'image' };
  if (startsWith(b, 0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', ext: 'png', family: 'image' };
  if (b.subarray(0, 4).toString() === 'GIF8') return { mime: 'image/gif', ext: 'gif', family: 'image' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp', family: 'image' };
  if (b.subarray(4, 8).toString() === 'ftyp') {
    const brand = b.subarray(8, 12).toString();
    if (/^(M4A|M4B)/.test(brand)) return { mime: 'audio/mp4', ext: 'm4a', family: 'audio' };
    if (/^(heic|heix|mif1)/.test(brand)) return { mime: 'image/heic', ext: 'heic', family: 'image' };
    if (/^qt/.test(brand)) return { mime: 'video/quicktime', ext: 'mov', family: 'video' };
    return { mime: 'video/mp4', ext: 'mp4', family: 'video' };
  }
  if (startsWith(b, 0x1a, 0x45, 0xdf, 0xa3)) return { mime: 'video/webm', ext: 'webm', family: 'video' }; // also audio/webm from MediaRecorder
  if (b.subarray(0, 4).toString() === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', family: 'audio' };
  if (b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3', family: 'audio' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE') return { mime: 'audio/wav', ext: 'wav', family: 'audio' };
  if (b.subarray(0, 4).toString() === '%PDF') return { mime: 'application/pdf', ext: 'pdf', family: 'document' };
  if (startsWith(b, 0x50, 0x4b, 0x03, 0x04)) return { mime: 'application/zip', ext: 'zip', family: 'document' }; // docx/xlsx/pptx
  return null;
}
const looksLikeText = (b: Buffer) => { const s = b.subarray(0, 2048); return !s.includes(0) && s.toString('utf8').indexOf('�') === -1; };
const BLOCKED_EXT = /\.(exe|dll|bat|cmd|com|scr|msi|sh|ps1|apk|jar|js|mjs|vbs|php|html?|svg)$/i;

export interface Upload { buffer: Buffer; originalname: string; mimetype: string; size: number }
export interface Saved { key: string; thumbKey?: string; mime: string; size: number; width?: number; height?: number; durationMs?: number; kind: Kind; fileName: string }

/** Validate + (for images) re-encode: strips EXIF/GPS metadata, caps size, writes a thumbnail. */
export async function saveUpload(file: Upload, opts: { folder: string; accept: Kind[]; thumb?: number; maxDim?: number; trim?: { startSec?: number; endSec?: number }; maxVideoSec?: number }): Promise<Saved> {
  const kindOf = sniff(file.buffer);
  let family = kindOf?.family;
  let mime = kindOf?.mime; let ext = kindOf?.ext;
  if (!kindOf && opts.accept.includes('document') && looksLikeText(file.buffer) && /\.(txt|csv|md|json)$/i.test(file.originalname)) {
    family = 'document'; mime = 'text/plain'; ext = 'txt';
  }
  if (!family || !mime || !ext) throw new HttpError(415, 'Unsupported or unrecognised file type', 'unsupported_media');
  if (BLOCKED_EXT.test(file.originalname)) throw new HttpError(415, 'This file type is not allowed', 'unsupported_media');
  let kind: Kind;
  if (family === 'image') kind = mime === 'image/gif' && opts.accept.includes('gif') ? 'gif' : 'image';
  else if (family === 'video') kind = 'video';
  else if (family === 'audio') kind = 'voice';
  else kind = 'document';
  // webm from MediaRecorder can be audio-only; allow it as voice when the caller accepts voice but not video
  if (kind === 'video' && mime === 'video/webm' && !opts.accept.includes('video') && opts.accept.includes('voice')) kind = 'voice';
  if (!opts.accept.includes(kind)) throw new HttpError(415, `A ${kind} file is not accepted here`, 'unsupported_media');

  const day = new Date();
  const base = `${opts.folder}/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(16).toString('hex')}`;
  let buf = file.buffer; let width: number | undefined; let height: number | undefined; let thumbKey: string | undefined;
  if (kind === 'image' && mime !== 'image/heic') {
    const img = sharp(buf, { failOn: 'error' }).rotate(); // honour EXIF orientation, then drop metadata on output
    const meta = await img.metadata();
    const max = opts.maxDim ?? 2048;
    const out = await img.clone().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    buf = out.data; mime = 'image/webp'; ext = 'webp'; width = out.info.width; height = out.info.height;
    if (opts.thumb) {
      const t = await img.clone().resize({ width: opts.thumb, height: opts.thumb, fit: 'cover' }).webp({ quality: 70 }).toBuffer();
      thumbKey = `${base}_t.webp`;
      await put(thumbKey, t, 'image/webp');
    }
    void meta;
  }
  let durationMs: number | undefined;
  if (kind === 'video') {
    // trim + compress (H.264/AAC, <=720p) and make a poster frame when ffmpeg is installed; otherwise store as uploaded
    const trimmed = await compressVideo(buf, opts.trim);
    if (trimmed && trimmed.length) { buf = trimmed; mime = 'video/mp4'; ext = 'mp4'; }
    durationMs = (await probeDurationMs(buf)) ?? undefined;
    if (opts.maxVideoSec && durationMs && durationMs > opts.maxVideoSec * 1000) throw new HttpError(400, `Videos can be up to ${opts.maxVideoSec} seconds`, 'video_too_long');
    if (opts.thumb) {
      const poster = await videoPoster(buf);
      if (poster) { thumbKey = `${base}_t.webp`; await put(thumbKey, await sharp(poster).resize({ width: opts.thumb, height: opts.thumb, fit: 'cover' }).webp({ quality: 70 }).toBuffer(), 'image/webp'); }
    }
  }
  const key = `${base}.${ext}`;
  await put(key, buf, mime);
  return { key, thumbKey, mime, size: buf.length, width, height, durationMs, kind, fileName: file.originalname.slice(0, 120) };
}

async function put(key: string, body: Buffer, contentType: string) {
  if (env.STORAGE_DRIVER === 's3') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await s3Client()).send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=31536000, immutable' }));
    return;
  }
  const file = path.join(root, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function removeObject(key?: string | null) {
  if (!key || /^(https?:)?\//.test(key)) return;
  try {
    if (env.STORAGE_DRIVER === 's3') {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await s3Client()).send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    } else {
      await fs.rm(path.join(root, key), { force: true });
    }
  } catch { /* best effort */ }
}

/** Key or external URL -> URL the client can load. Signed URLs are quantised to the TTL window so they stay cacheable. */
export function toUrl(v?: string | null): string | null {
  if (!v) return null;
  if (/^(https?:)?\/\//.test(v) || v.startsWith('/') || v.startsWith('data:')) return v; // external, seed or frontend asset
  const ttl = env.MEDIA_URL_TTL;
  const exp = (Math.floor(Date.now() / 1000 / ttl) + 2) * ttl;
  if (env.STORAGE_DRIVER === 's3') {
    // Presigning is async in the SDK; use the local HMAC proxy route for synchronous URL building, which streams from S3.
    return `${env.PUBLIC_URL}/media/${v}?exp=${exp}&sig=${sign(v, exp)}`;
  }
  return `${env.PUBLIC_URL}/media/${v}?exp=${exp}&sig=${sign(v, exp)}`;
}

export function verifySigned(key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const good = sign(key, exp);
  return good.length === sig.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig));
}

export async function readObject(key: string): Promise<{ stream: NodeJS.ReadableStream | Buffer; size?: number; mime: string } | null> {
  const mime = mimeFromKey(key);
  if (env.STORAGE_DRIVER === 's3') {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await s3Client()).send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return { stream: r.Body as NodeJS.ReadableStream, size: r.ContentLength, mime: r.ContentType || mime };
    } catch { return null; }
  }
  const file = path.join(root, key);
  if (!file.startsWith(root + path.sep)) return null; // path traversal guard
  try { const st = await fs.stat(file); return { stream: (await import('node:fs')).createReadStream(file), size: st.size, mime }; } catch { return null; }
}
const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip' };
const mimeFromKey = (k: string) => MIME[k.split('.').pop() || ''] || 'application/octet-stream';
