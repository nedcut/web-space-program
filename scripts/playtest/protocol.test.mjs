import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const expect = value => ({ toEqual: other => assert.deepEqual(value, other), toBe: other => assert.equal(value, other), toThrow: pattern => assert.throws(value, pattern) });
import { parse, seconds, readActions } from './protocol.mjs';

describe('playtest command protocol', () => {
  it('preserves text and isolates session options', () => {
    expect(parse(['note', 'expected a countdown', '--session', 'pilot-2'])).toEqual({ command: 'note', args: ['expected a countdown'], options: { session: 'pilot-2' } });
    expect(parse(['key', 'Shift', '--hold', '2.5']).options.hold).toBe('2.5');
  });
  it('rejects path traversal, arbitrary eval and malformed durations/options', () => {
    for (const args of [['look', '--session', '../escape'], ['eval', '1'], ['wait', '--bad'], ['look', '--session'], ['key', 'z', '--hold', '-1'], ['look', '--until', '0']]) expect(() => parse(args)).toThrow();
    for (const n of [undefined, 'NaN', '-1', '3601']) expect(() => seconds(n)).toThrow();
    expect(seconds('0.02')).toBe(20);
  });
  it('accepts trimmed replay records and rejects debug or malformed records', () => {
    const a = { version: 1, step: 7, command: 'wait', args: ['1'], gameTime: 12, scene: 'flight', ok: true, errors: [] };
    expect(readActions(JSON.stringify(a) + '\n')).toEqual([a]);
    expect(() => readActions(JSON.stringify({ ...a, command: 'debug' }))).toThrow(/Debug/);
    expect(() => readActions(JSON.stringify({ ...a, args: [1] }))).toThrow(/Invalid/);
  });
});
