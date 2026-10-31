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
