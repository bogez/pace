// Generates the Pace app icon as a PNG — zero dependencies, pure Node.
// Usage: node scripts/make-icon.mjs [out.png] [size]
// Exists so neither CI nor contributors need ImageMagick (a lesson from the
// prototype). Colors come from the engine PALETTE — the icon can never drift
// from the product (bogez/pace#3 single-source contract).

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { PALETTE } from "../src/pace.js";

const OUT = process.argv[2] ?? "app-icon.png";
const S = +(process.argv[3] ?? 1024);

/* ---------- draw into an RGBA buffer ---------- */
const px = new Uint8Array(S * S * 4);
const put = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  // src-over composite
  const sa = a / 255, da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  px[i]     = Math.round((r * sa + px[i]     * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
};

const u = (v) => Math.round((v / 1024) * S);   // design coords → pixels
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const { blue: BLUE, green: GREEN, red: RED } = PALETTE;

// rounded-rect background #1a1a19, radius 224
{
  const R = u(224);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = Math.max(R - x, x - (S - 1 - R), 0);
      const cy = Math.max(R - y, y - (S - 1 - R), 0);
      const inside = cx === 0 || cy === 0 || Math.hypot(cx, cy) <= R;
      if (inside) put(x, y, 26, 26, 25, 255);
    }
  }
}

// gradient pill: x 160→864, y 416→608, blue→green→red (the pace spectrum)
{
  const x0 = u(160), x1 = u(864), y0 = u(416), y1 = u(608);
  const R = (y1 - y0) / 2, cy = (y0 + y1) / 2;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // rounded ends
      const ex = x < x0 + R ? x0 + R : x > x1 - R ? x1 - R : x;
      if (Math.hypot(x - ex, y - cy) > R) continue;
      const t = (x - x0) / (x1 - x0);
      const c = t < 0.5 ? lerp(BLUE, GREEN, t * 2) : lerp(GREEN, RED, (t - 0.5) * 2);
      put(x, y, c[0] | 0, c[1] | 0, c[2] | 0, 255);
    }
  }
}

// center dot: white ring r=170, green fill r=150 ("in the zone")
{
  const c = S / 2;
  const ring = u(170), dot = u(150);
  for (let y = c - ring - 2; y <= c + ring + 2; y++) {
    for (let x = c - ring - 2; x <= c + ring + 2; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= ring) {
        const aa = Math.min(1, ring - d + 0.5) * 255;
        if (d <= dot) put(x | 0, y | 0, GREEN[0], GREEN[1], GREEN[2], 255);
        else put(x | 0, y | 0, 255, 255, 255, Math.max(0, aa) | 0);
      }
    }
  }
}

/* ---------- encode PNG ---------- */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

// raw scanlines with filter byte 0
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${S}x${S}, ${png.length} bytes)`);
