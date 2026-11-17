import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Optional video tooling. Everything degrades gracefully when ffmpeg is not installed (the Docker image ships it).
let available: boolean | null = null;
const run = (cmd: string, args: string[], timeoutMs = 120_000) => new Promise<{ code: number; out: string }>((resolve) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
  p.on('error', () => { clearTimeout(t); resolve({ code: 127, out }); });
  p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
});
export async function hasFfmpeg() { if (available === null) available = (await run('ffmpeg', ['-version'], 5000)).code === 0; return available; }

async function withTmp<T>(buf: Buffer, fn: (inFile: string, dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), `smu-${crypto.randomBytes(8).toString('hex')}`);
  await fs.mkdir(dir, { recursive: true });
  const inFile = path.join(dir, 'in.bin'); await fs.writeFile(inFile, buf);
  try { return await fn(inFile, dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export async function probeDurationMs(buf: Buffer): Promise<number | null> {
  if (!(await hasFfmpeg())) return null;
  return withTmp(buf, async (f) => {
    const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], 15_000);
    const s = parseFloat(r.out.trim()); return Number.isFinite(s) ? Math.round(s * 1000) : null;
  });
}
export async function videoPoster(buf: Buffer, atSec = 0.5): Promise<Buffer | null> {
  if (!(await hasFfmpeg())) return null;
  return withTmp(buf, async (f, dir) => {
    const out = path.join(dir, 'p.jpg');
    let r = await run('ffmpeg', ['-y', '-ss', String(atSec), '-i', f, '-frames:v', '1', '-vf', 'scale=720:-2', out], 30_000);
    if (r.code !== 0) r = await run('ffmpeg', ['-y', '-i', f, '-frames:v', '1', '-vf', 'scale=720:-2', out], 30_000);
    try { return await fs.readFile(out); } catch { return null; }
  });
}
/** Re-encode to H.264/AAC (max 720p) with optional trim. Returns null on failure so callers keep the original. */
export async function compressVideo(buf: Buffer, opts: { startSec?: number; endSec?: number } = {}): Promise<Buffer | null> {
  if (!(await hasFfmpeg())) return null;
  return withTmp(buf, async (f, dir) => {
    const out = path.join(dir, 'o.mp4');
    const args = ['-y', ...(opts.startSec ? ['-ss', String(opts.startSec)] : []), '-i', f, ...(opts.endSec ? ['-to', String(Math.max(0.1, opts.endSec - (opts.startSec || 0)))] : []),
      '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out];
    const r = await run('ffmpeg', args, 180_000);
    if (r.code !== 0) return null;
    try { return await fs.readFile(out); } catch { return null; }
  });
}
