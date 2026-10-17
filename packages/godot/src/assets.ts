import { deflateSync } from 'node:zlib';
import { createRng } from './level-generator.js';

/**
 * Placeholder asset generation (Asset Manager / Audio Designer).
 * Everything is synthesized locally — no downloads, no third-party licenses.
 */

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** Encodes RGB pixels (row-major, 3 bytes per pixel) as PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexColor(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Seamless noisy tile texture (concrete / plaster look). */
export function noiseTexture(size: number, baseHex: string, seed: number, tiles = false): Buffer {
  const rng = createRng(seed);
  const [r, g, b] = hexColor(baseHex);
  const pixels = new Uint8Array(size * size * 3);
  // Low-frequency value noise on a wrapping grid keeps the texture tileable.
  const grid = 8;
  const values = Array.from({ length: grid * grid }, () => rng());
  const lerp = (a: number, c: number, t: number) => a + (c - a) * t;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * grid;
      const gy = (y / size) * grid;
      const x0 = Math.floor(gx) % grid;
      const y0 = Math.floor(gy) % grid;
      const x1 = (x0 + 1) % grid;
      const y1 = (y0 + 1) % grid;
      const tx = gx - Math.floor(gx);
      const ty = gy - Math.floor(gy);
      const smooth = lerp(
        lerp(values[y0 * grid + x0]!, values[y0 * grid + x1]!, tx),
        lerp(values[y1 * grid + x0]!, values[y1 * grid + x1]!, tx),
        ty,
      );
      let shade = 0.82 + smooth * 0.22 + (rng() - 0.5) * 0.08;
      if (tiles && (x % (size / 4) === 0 || y % (size / 4) === 0)) shade *= 0.72;
      const i = (y * size + x) * 3;
      pixels[i] = Math.max(0, Math.min(255, Math.round(r * shade)));
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(g * shade)));
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(b * shade)));
    }
  }
  return encodePng(size, size, pixels);
}

/** Project icon (SVG). */
export function iconSvg(title: string, accent = '#e8a33a'): string {
  const letter = (title.trim()[0] ?? 'G').toUpperCase().replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="#14161b"/>
  <rect x="6" y="6" width="116" height="116" rx="16" fill="none" stroke="${accent}" stroke-width="4"/>
  <text x="64" y="84" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" text-anchor="middle" fill="${accent}">${letter}</text>
</svg>
`;
}

// ------------------------------------------------------------------ WAV

const SAMPLE_RATE = 22050;

export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

type Synth = (t: number, i: number, rng: () => number) => number;

function render(seconds: number, synth: Synth, seed = 1): Float32Array {
  const rng = createRng(seed);
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i++) samples[i] = synth(i / SAMPLE_RATE, i, rng);
  return samples;
}

const env = (t: number, attack: number, decay: number) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / decay);
const sine = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
const square = (f: number, t: number) => (sine(f, t) >= 0 ? 1 : -1);

function lowpass(samples: Float32Array, amount: number): Float32Array {
  let last = 0;
  for (let i = 0; i < samples.length; i++) {
    last += amount * (samples[i]! - last);
    samples[i] = last;
  }
  return samples;
}

function normalize(samples: Float32Array, peak = 0.8): Float32Array {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max > 0) for (let i = 0; i < samples.length; i++) samples[i] = (samples[i]! / max) * peak;
  return samples;
}

/** Placeholder sound effects keyed by event name. */
export function synthesizeSounds(mood: 'dark' | 'calm'): Record<string, Buffer> {
  const sounds: Record<string, Float32Array> = {
    pickup: render(
      0.25,
      (t) =>
        (sine(t < 0.09 ? 880 : 1320, t) * 0.6 + sine(t < 0.09 ? 1760 : 2640, t) * 0.15) *
        env(t, 0.005, 0.08),
    ),
    door_open: lowpass(
      render(
        0.7,
        (t, _i, rng) => ((rng() * 2 - 1) * 0.5 + sine(90 - t * 60, t) * 0.5) * env(t, 0.05, 0.25),
        2,
      ),
      0.08,
    ),
    door_locked: render(
      0.35,
      (t) =>
        square(60, t) * 0.5 * (env(t, 0.003, 0.05) + (t > 0.15 ? env(t - 0.15, 0.003, 0.05) : 0)),
    ),
    hurt: lowpass(
      render(
        0.35,
        (t, _i, rng) => ((rng() * 2 - 1) * 0.7 + sine(220 - t * 300, t) * 0.4) * env(t, 0.004, 0.1),
        3,
      ),
      0.25,
    ),
    enemy_alert: lowpass(
      render(
        1.0,
        (t, _i, rng) =>
          (square(55 + 8 * sine(6, t), t) * 0.5 + (rng() * 2 - 1) * 0.3) * env(t, 0.1, 0.45),
        4,
      ),
      0.06,
    ),
    win: render(0.9, (t) => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const index = Math.min(3, Math.floor(t / 0.15));
      return sine(notes[index]!, t) * 0.5 * env(t - index * 0.15, 0.01, 0.25);
    }),
    flicker: render(
      0.4,
      (t, _i, rng) =>
        (square(120, t) * 0.3 + (rng() < 0.02 ? rng() * 2 - 1 : 0)) *
        (rng() < 0.85 ? 1 : 0) *
        env(t, 0.01, 0.2),
      5,
    ),
    distant_noise: lowpass(
      render(
        1.4,
        (t, _i, rng) =>
          (rng() * 2 - 1) * env(t, 0.02, 0.35) + sine(48, t) * env(t, 0.01, 0.5) * 0.6,
        6,
      ),
      0.03,
    ),
    ambience: (() => {
      const seconds = 8;
      const samples = render(
        seconds,
        (t, _i, rng) => {
          const loopFade = Math.min(1, t / 0.5, (seconds - t) / 0.5);
          if (mood === 'dark') {
            return (
              ((rng() * 2 - 1) * 0.6 +
                sine(55, t) * 0.35 * (0.7 + 0.3 * sine(0.25, t)) +
                sine(82.4, t) * 0.12) *
              loopFade
            );
          }
          return (
            (sine(220, t) * 0.2 + sine(277.2, t) * 0.15 + sine(329.6, t) * 0.12) *
              (0.75 + 0.25 * sine(0.125, t)) *
              loopFade +
            (rng() * 2 - 1) * 0.04
          );
        },
        7,
      );
      return lowpass(samples, mood === 'dark' ? 0.02 : 0.2);
    })(),
  };
  const result: Record<string, Buffer> = {};
  for (const [name, samples] of Object.entries(sounds))
    result[name] = encodeWav(normalize(samples, name === 'ambience' ? 0.5 : 0.8));
  return result;
}
