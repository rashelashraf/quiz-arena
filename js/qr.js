/* ---------------------------------------------------------------------------
   qr.js — a small QR code encoder.

   Byte mode, error correction level M, versions 1 to 10, which covers any URL
   up to 213 characters. Written out in full rather than pulled from a CDN so
   that it still works on a school network that blocks everything, and so the
   student link never has to travel to a third party to become an image.
--------------------------------------------------------------------------- */

/* Data capacity in bytes, level M, versions 1-10. */
const CAPACITY = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

/* Per version at level M: [ec codewords per block, [[blocks, data codewords], …] ] */
const BLOCKS = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]]
];

/* Centres of the alignment patterns, per version. */
const ALIGN = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
];

/* ---------- arithmetic in GF(256) ---------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for n error-correction codewords. */
function generator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function ecCodewords(data, count) {
  const gen = generator(count);
  const rem = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < count; i++) rem[i] ^= mul(gen[i + 1], factor);
  }
  return rem;
}

/* ---------- BCH codes for the format and version areas -------------------- */

function bch(value, poly, bits) {
  let v = value << bits;
  const polyBits = 32 - Math.clz32(poly);
  while (32 - Math.clz32(v) >= polyBits) v ^= poly << (32 - Math.clz32(v) - polyBits);
  return v;
}

/** 15 bits: two for the level (M is 00), three for the mask, ten of checksum. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  return ((data << 10) | bch(data, 0b10100110111, 10)) ^ 0b101010000010010;
}

/** 18 bits, only written on version 7 and above. */
function versionBits(version) {
  return (version << 12) | bch(version, 0b1111100100101, 12);
}

/* ---------- building the symbol ------------------------------------------- */

/**
 * @param {string} text
 * @returns {{size:number, modules:boolean[][]}}
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);

  const version = CAPACITY.findIndex((cap) => bytes.length <= cap) + 1;
  if (version === 0) throw new Error(`That is too long for a QR code here: ${bytes.length} bytes, limit ${CAPACITY[9]}.`);

  const [ecPerBlock, groups] = BLOCKS[version - 1];
  const totalData = groups.reduce((sum, [n, d]) => sum + n * d, 0);

  /* bit stream: mode, length, payload, terminator, padding */
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  bytes.forEach((b) => push(b, 8));
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  }
  for (let i = 0; data.length < totalData; i++) data.push(i % 2 ? 0x11 : 0xec);

  /* split into blocks, work out the error correction, then interleave */
  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  groups.forEach(([count, size]) => {
    for (let i = 0; i < count; i++) {
      const block = data.slice(at, at + size);
      at += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, ecPerBlock));
    }
  });

  const stream = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    dataBlocks.forEach((b) => { if (i < b.length) stream.push(b[i]); });
  }
  for (let i = 0; i < ecPerBlock; i++) ecBlocks.forEach((b) => stream.push(b[i]));

  /* lay out the modules */
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array(size).fill(null));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (r, c, dark) => { grid[r][c] = dark; fixed[r][c] = true; };

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const edge = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        put(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && edge !== 2);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) { put(6, i, i % 2 === 0); put(i, 6, i % 2 === 0); }

  // Alignment patterns go at every pairing of the centres, except the three
  // that would land on a finder. They are drawn even when they cross the
  // timing line, which is what versions 7 and up need.
  const centres = ALIGN[version - 1];
  const first = centres[0];
  const last = centres[centres.length - 1];
  const onAFinder = (r, c) =>
    (r === first && c === first) || (r === first && c === last) || (r === last && c === first);

  centres.forEach((r) => centres.forEach((c) => {
    if (onAFinder(r, c)) return;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        put(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
  }));

  put(size - 8, 8, true);                          // the always-dark module

  /* reserve the format areas so data does not land on them */
  for (let i = 0; i < 9; i++) {
    if (!fixed[8][i]) put(8, i, false);
    if (!fixed[i][8]) put(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!fixed[8][size - 1 - i]) put(8, size - 1 - i, false);
    if (!fixed[size - 1 - i][8]) put(size - 1 - i, 8, false);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3), c = i % 3;
      put(size - 11 + c, r, false);
      put(r, size - 11 + c, false);
    }
  }

  /* zigzag the data in from the bottom right */
  let bit = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                          // step over the timing column
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (fixed[row][c]) continue;
        const byte = stream[bit >> 3];
        grid[row][c] = byte !== undefined && ((byte >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    up = !up;
  }

  /* try every mask, keep the tidiest */
  const maskAt = (m, r, c) => [
    (r + c) % 2, r % 2, c % 3, (r + c) % 3,
    (Math.floor(r / 2) + Math.floor(c / 3)) % 2,
    ((r * c) % 2) + ((r * c) % 3),
    (((r * c) % 2) + ((r * c) % 3)) % 2,
    (((r + c) % 2) + ((r * c) % 3)) % 2
  ][m] === 0;

  let best = null;
  for (let m = 0; m < 8; m++) {
    const test = grid.map((row) => [...row]);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (!fixed[r][c] && maskAt(m, r, c)) test[r][c] = !test[r][c];
    }
    writeFormat(test, size, m);
    if (version >= 7) writeVersion(test, size, version);
    const p = penalty(test, size);
    if (!best || p < best.score) best = { score: p, modules: test };
  }

  return { size, modules: best.modules, version };
}

/* The two copies of the format information run in opposite directions, which
   is easy to get backwards. Both orderings below are checked against a
   reference encoder in the test suite. */
const FORMAT_SEQ = [
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
  [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
];

function writeFormat(m, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => ((bits >> i) & 1) === 1;      // i = 0 is the least significant

  // Top left: most significant bit first.
  FORMAT_SEQ.forEach(([r, c], place) => { m[r][c] = bit(14 - place); });

  // The copy split across the other two corners: least significant bit first.
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
}

function writeVersion(m, size, version) {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const on = ((bits >> i) & 1) === 1;
    const r = Math.floor(i / 3), c = i % 3;
    m[size - 11 + c][r] = on;
    m[r][size - 11 + c] = on;
  }
}

/** The four tidiness rules from the specification. */
function penalty(m, size) {
  let score = 0;

  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let last = null, len = 0;
      for (let b = 0; b < size; b++) {
        const v = get(a, b);
        if (v === last) { len++; } else { if (len >= 5) score += len - 2; last = v; len = 1; }
      }
      if (len >= 5) score += len - 2;
    }
  };
  run((r, c) => m[r][c]);
  run((c, r) => m[r][c]);

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  const pattern = [true, false, true, true, true, false, true];
  const matches = (cells) => {
    for (let i = 0; i < 7; i++) if (cells[i] !== pattern[i]) return false;
    return true;
  };
  const light = (cells) => cells.every((v) => v === false);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const at = (i) => {
          const rr = r + dr * i, cc = c + dc * i;
          return rr < size && cc < size ? m[rr][cc] : null;
        };
        const core = [0, 1, 2, 3, 4, 5, 6].map(at);
        if (core.includes(null) || !matches(core)) continue;
        const before = [-4, -3, -2, -1].map((i) => {
          const rr = r + dr * i, cc = c + dc * i;
          return rr >= 0 && cc >= 0 ? m[rr][cc] : null;
        });
        const after = [7, 8, 9, 10].map(at);
        if (!before.includes(null) && light(before)) score += 40;
        if (!after.includes(null) && light(after)) score += 40;
      }
    }
  }

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;

  return score;
}

/* ---------- drawing --------------------------------------------------------- */

/**
 * @param {string} text
 * @param {{scale?:number, quiet?:number, dark?:string, light?:string}} opts
 * @returns {SVGElement}
 */
export function qrSvg(text, opts = {}) {
  const { scale = 6, quiet = 4, dark = '#101f33', light = '#ffffff' } = opts;
  const { size, modules } = qrMatrix(text);
  const total = (size + quiet * 2) * scale;

  const path = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path.push(`M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`);
    }
  }

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', total);
  svg.setAttribute('height', total);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `QR code for ${text}`);

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', total);
  bg.setAttribute('height', total);
  bg.setAttribute('fill', light);
  svg.appendChild(bg);

  const fg = document.createElementNS(ns, 'path');
  fg.setAttribute('d', path.join(''));
  fg.setAttribute('fill', dark);
  svg.appendChild(fg);

  return svg;
}
