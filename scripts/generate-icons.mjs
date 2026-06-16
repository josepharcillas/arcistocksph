// Generates the PWA icons the manifest references (public/icon-192.png, -512.png)
// without any image deps — a minimal PNG encoder. Green disc on slate, matching
// the app theme. Re-run if the brand changes.
import zlib from 'node:zlib';
import fs from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2, r = size * 0.34;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const inDisc = Math.hypot(x - c, y - c) < r;
      const [R, G, B] = inDisc ? [0x4a, 0xde, 0x80] : [0x0f, 0x17, 0x2a];
      raw[o] = R; raw[o + 1] = G; raw[o + 2] = B; raw[o + 3] = 255;
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/icon-192.png', png(192));
fs.writeFileSync('public/icon-512.png', png(512));
console.log('wrote public/icon-192.png and public/icon-512.png');
