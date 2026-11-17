// Story music: built-in tracks are synthesised in the browser (no copyrighted audio, no downloads),
// then rendered to a 15 s WAV blob so a library track behaves exactly like an uploaded / recorded file.
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export const TRACKS = [
  { id: 'chill', name: 'Chill Vibes', mood: 'Relaxed', bpm: 84, wave: 'sine', drums: false, chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], lead: [[2, null, 1, 2, null, 0, 1, null], [0, 1, 2, null, 1, null, 0, null]] },
  { id: 'lofi', name: 'Lo-fi Sunset', mood: 'Mellow', bpm: 72, wave: 'triangle', drums: true, chords: [[62, 65, 69, 72], [55, 59, 62, 65], [60, 64, 67, 71], [57, 60, 64, 67]], lead: [[3, null, 2, null, 1, 2, null, 3], [null, 2, 3, null, 1, null, 2, null]] },
  { id: 'drive', name: 'Night Drive', mood: 'Energetic', bpm: 100, wave: 'sawtooth', drums: true, chords: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]], lead: [[0, 2, 1, 2, 0, 2, 1, 2], [2, 1, 0, 1, 2, null, 1, null]] },
  { id: 'happy', name: 'Happy Days', mood: 'Upbeat', bpm: 120, wave: 'square', drums: true, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], lead: [[0, 1, 2, 1, 2, 1, 0, null], [2, 2, 1, 0, 1, 2, 2, null]] },
  { id: 'dream', name: 'Dreamy', mood: 'Calm', bpm: 66, wave: 'sine', drums: false, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], lead: [[3, null, null, 2, null, null, 1, null], [null, 2, null, null, 3, null, null, 1]] },
  { id: 'piano', name: 'Soft Piano', mood: 'Gentle', bpm: 76, wave: 'triangle', drums: false, chords: [[57, 60, 64], [60, 64, 67], [62, 65, 69], [55, 59, 62]], lead: [[0, 1, 2, 1, 0, 1, 2, 1], [2, 1, 0, 1, 2, null, 1, 0]] },
];

function wav(buf) {
  const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  return new Blob([out], { type: 'audio/wav' });
}

const cache = new Map();
export async function renderTrack(id, secs = 15) {
  if (cache.has(id)) return cache.get(id);
  const t = TRACKS.find((x) => x.id === id); const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!t || !Off) throw new Error('Audio is not supported on this device');
  const sr = 22050, ctx = new Off(1, sr * secs, sr), beat = 60 / t.bpm, bar = beat * 4;
  const master = ctx.createGain(); master.gain.setValueAtTime(.55, 0); master.gain.setValueAtTime(.55, secs - 1.2); master.gain.linearRampToValueAtTime(0, secs); master.connect(ctx.destination);
  const tone = (midi, at, dur, type, vol, lp) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = mtof(midi); f.type = 'lowpass'; f.frequency.value = lp;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + .02); g.gain.exponentialRampToValueAtTime(.0008, at + dur);
    o.connect(f); f.connect(g); g.connect(master); o.start(at); o.stop(at + dur + .05);
  };
  const noise = ctx.createBuffer(1, sr * .1, sr); const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const hat = (at, vol) => { const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter(); s.buffer = noise; f.type = 'highpass'; f.frequency.value = 6500; g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.001, at + .05); s.connect(f); f.connect(g); g.connect(master); s.start(at); };
  const kick = (at) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, at); o.frequency.exponentialRampToValueAtTime(42, at + .12); g.gain.setValueAtTime(.55, at); g.gain.exponentialRampToValueAtTime(.001, at + .22); o.connect(g); g.connect(master); o.start(at); o.stop(at + .25); };
  for (let b = 0, at = 0; at < secs; b++, at = b * bar) {
    const ch = t.chords[b % t.chords.length], pat = t.lead[b % t.lead.length];
    ch.forEach((n) => tone(n - 12, at, bar, 'triangle', .05, 1100));
    tone(ch[0] - 24, at, beat * 1.8, 'sine', .3, 400); tone(ch[0] - 24, at + beat * 2, beat * 1.8, 'sine', .26, 400);
    pat.forEach((p, i) => { if (p != null) tone(ch[p % ch.length] + (p > 2 ? 12 : 0), at + i * beat / 2, beat * (t.wave === 'sine' ? 1.4 : .6), t.wave, t.wave === 'sawtooth' || t.wave === 'square' ? .05 : .13, 2400); });
    if (t.drums) for (let i = 0; i < 8; i++) { hat(at + i * beat / 2, i % 2 ? .06 : .035); if (i % 4 === 0) kick(at + i * beat / 2); }
  }
  const url = URL.createObjectURL(wav(await ctx.startRendering()));
  cache.set(id, url); return url;
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })); }; });
  rec.start();
  return { stop: () => { if (rec.state !== 'inactive') rec.stop(); return done; } };
}
