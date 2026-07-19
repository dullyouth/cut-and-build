// Dependency-free PNG icon generator. Draws a flat dumbbell mark on the app's
// dark background at several sizes for the manifest + iOS home screen.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---- minimal PNG encoder (RGBA, no filtering) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
};
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- draw dumbbell ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#0f151c');
const FG = hex('#4ade80');

function draw(N) {
  const buf = Buffer.alloc(N * N * 4);
  const put = (x, y, [r, g, b]) => { const i = (y * N + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; };
  const rect = (x0, y0, x1, y1, col) => {
    for (let y = Math.max(0, y0 | 0); y < Math.min(N, y1 | 0); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(N, x1 | 0); x++) put(x, y, col);
  };
  // background
  rect(0, 0, N, N, BG);
  // dumbbell (coordinates as fractions of N)
  const f = (v) => v * N;
  rect(f(0.34), f(0.46), f(0.66), f(0.54), FG); // handle
  rect(f(0.27), f(0.36), f(0.34), f(0.64), FG); // inner plate L
  rect(f(0.66), f(0.36), f(0.73), f(0.64), FG); // inner plate R
  rect(f(0.21), f(0.40), f(0.27), f(0.60), FG); // outer plate L
  rect(f(0.73), f(0.40), f(0.79), f(0.60), FG); // outer plate R
  return encodePNG(N, N, buf);
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(OUT, name), draw(size));
  console.log('wrote', name, size + 'px');
}
