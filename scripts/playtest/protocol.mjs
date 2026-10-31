import { inflateSync } from 'node:zlib';
export const COMMANDS = new Set(['start', 'stop', 'look', 'click', 'type', 'key', 'drag', 'move', 'scroll', 'wait', 'shot', 'note', 'debug', 'replay']);
export function parse(argv) {
  const args = [], options = { session: 'default' };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (['--session', '--hold', '--until'].includes(word)) {
      if (!argv[i + 1]) throw new Error(`Missing value for ${word}`);
      options[word.slice(2)] = argv[++i];
    } else if (word.startsWith('--')) throw new Error(`Unknown option ${word}`);
    else args.push(word);
  }
  const command = args.shift();
  if (!COMMANDS.has(command)) throw new Error('Commands: ' + [...COMMANDS].join(', '));
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(options.session)) throw new Error('Session name: 1–40 letters, digits, _ or -');
  if (options.hold !== undefined) seconds(options.hold);
  if (options.until !== undefined && !/^[1-9]\d*$/.test(options.until)) throw new Error('--until must be a positive step number');
  return { command, args, options };
}
export function seconds(value) {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n < 0 || n > 3600) throw new Error('Seconds must be between 0 and 3600');
  return Math.round(n * 1000);
}
export function readActions(text) {
  return text.trim().split('\n').filter(Boolean).map((line, i) => {
    const a = JSON.parse(line);
    if (a.version !== 1 || !COMMANDS.has(a.command) || !Array.isArray(a.args) || !a.args.every(v => typeof v === 'string')) throw new Error(`Invalid action at line ${i + 1}`);
    if (a.command === 'debug') throw new Error('Debug sessions cannot be replayed as honest player sessions');
    return a;
  });
}

/** Brightness stats of an 8-bit non-interlaced PNG (Chromium screenshots): samples above 15/255 and spread. */
export function pngStats(png) {
  let pos = 8, width = 0, height = 0, channels = 0; const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[data[9]]; if (data[8] !== 8 || data[12]) throw new Error('Unsupported PNG'); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0, b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0, p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[y * stride + x] = (row[x] + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  let lit = 0, min = 255, max = 0;
  for (let i = 0; i < out.length; i += channels) {
    const v = channels < 3 ? out[i] : Math.max(out[i], out[i + 1], out[i + 2]);
    if (v > 15) lit++; min = Math.min(min, v); max = Math.max(max, v);
  }
  return { lit, spread: max - min };
}
