#!/usr/bin/env node
/*
 * make-icons.js  ―  依存ライブラリなしの PWA アイコン生成ツール
 *
 * 使い方:
 *   node tools/make-icons.js [input.png] [outdir]
 *   例) node tools/make-icons.js icon-master.png .
 *
 * 入力（Codex / gpt-image 等で生成した正方形PNG・推奨1024x1024）を
 * icon-192.png / icon-512.png / icon-180.png / favicon-32.png に縮小します。
 * 透明部分はパステル背景(#fde8f2)に合成します（maskable向けに不透明化）。
 *
 * 対応PNG: 8-bit, colorType 0(gray)/2(RGB)/3(palette)/4(gray+alpha)/6(RGBA),
 *          interlace=0（非インターレース）。
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const BG = [253, 232, 242]; // #fde8f2

/* ---------- PNG decode ---------- */
function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('PNGではありません（シグネチャ不一致）');
  let off = 8, ihdr = null, idat = [], plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = {
      width: data.readUInt32BE(0), height: data.readUInt32BE(4),
      bitDepth: data[8], colorType: data[9], interlace: data[12]
    };
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('IHDRが見つかりません');
  if (ihdr.bitDepth !== 8) throw new Error('bitDepth=8 のPNGのみ対応（入力は ' + ihdr.bitDepth + '）');
  if (ihdr.interlace !== 0) throw new Error('非インターレースPNGのみ対応');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error('未対応のcolorType: ' + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: W, height: H } = ihdr;
  const bpp = channels;            // bytes per pixel (8-bit)
  const stride = W * bpp;
  const out = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[pos++];
    const row = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error('未知のフィルタ: ' + filter);
      }
      row[x] = r & 0xff;
    }
  }
  // → RGBA
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    let R, G, B, A = 255;
    const o = i * bpp;
    if (ihdr.colorType === 0) { R = G = B = out[o]; }
    else if (ihdr.colorType === 2) { R = out[o]; G = out[o + 1]; B = out[o + 2]; }
    else if (ihdr.colorType === 4) { R = G = B = out[o]; A = out[o + 1]; }
    else if (ihdr.colorType === 6) { R = out[o]; G = out[o + 1]; B = out[o + 2]; A = out[o + 3]; }
    else if (ihdr.colorType === 3) { const idx = out[o]; if (!plte) throw new Error('PLTEがありません'); R = plte[idx * 3]; G = plte[idx * 3 + 1]; B = plte[idx * 3 + 2]; A = trns && idx < trns.length ? trns[idx] : 255; }
    const j = i * 4; rgba[j] = R; rgba[j + 1] = G; rgba[j + 2] = B; rgba[j + 3] = A;
  }
  return { width: W, height: H, data: rgba };
}

/* ---------- resize (area average) + flatten onto BG ---------- */
function resizeFlatten(src, sw, sh, dw, dh) {
  const dst = new Uint8Array(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * fy), y1 = Math.max(y0 + 1, Math.floor((dy + 1) * fy));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * fx), x1 = Math.max(x0 + 1, Math.floor((dx + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1 && y < sh; y++) for (let x = x0; x < x1 && x < sw; x++) {
        const o = (y * sw + x) * 4; const a = src[o + 3] / 255;
        // composite over BG
        r += src[o] * a + BG[0] * (1 - a);
        g += src[o + 1] * a + BG[1] * (1 - a);
        b += src[o + 2] * a + BG[2] * (1 - a);
        n++;
      }
      const o = (dy * dw + dx) * 4;
      dst[o] = Math.round(r / n); dst[o + 1] = Math.round(g / n); dst[o + 2] = Math.round(b / n); dst[o + 3] = 255;
    }
  }
  return dst;
}

/* ---------- PNG encode (RGBA, colorType 6) ---------- */
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); }
function encodePNG(W, H, rgba) {
  const out = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) { out[y * (1 + W * 4)] = 0; rgba.subarray ? out.set(rgba.subarray(y * W * 4, y * W * 4 + W * 4), y * (1 + W * 4) + 1) : null; }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const idat = zlib.deflateSync(out, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- main ---------- */
const input = process.argv[2] || 'icon-master.png';
const outdir = process.argv[3] || '.';
if (!fs.existsSync(input)) { console.error('入力が見つかりません: ' + input + '\n  Codex等で生成した正方形PNGを置いてから実行してください。'); process.exit(1); }
const img = decodePNG(fs.readFileSync(input));
if (img.width !== img.height) console.warn('⚠ 正方形ではありません（' + img.width + 'x' + img.height + '）。中央が切れる場合があります。');
const SIZES = [['icon-192.png', 192], ['icon-512.png', 512], ['icon-180.png', 180], ['favicon-32.png', 32]];
for (const [name, size] of SIZES) {
  const resized = resizeFlatten(img.data, img.width, img.height, size, size);
  const png = encodePNG(size, size, resized);
  fs.writeFileSync(path.join(outdir, name), png);
  console.log('✅ ' + name + ' (' + size + 'x' + size + ', ' + png.length + ' bytes)');
}
console.log('かんりょう！manifest と <head> はすでに これらの ファイル名を 参照しています。');
