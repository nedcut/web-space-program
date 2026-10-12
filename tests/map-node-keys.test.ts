import { describe, expect, it } from 'vitest';
import { cycleNodeId, mapKeyHelp, nodeKeyCommand, nudged } from '../src/ui/map/nodeKeys';

const key = (code: string, mods: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
  ({ code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe('map node keys', () => {
  it('maps arrows to prograde and normal, Alt+up/down to radial', () => {
    expect(nodeKeyCommand(key('ArrowUp'))).toEqual({ kind: 'nudge', axis: 'prograde', sign: 1, step: 1 });
    expect(nodeKeyCommand(key('ArrowDown'))).toEqual({ kind: 'nudge', axis: 'prograde', sign: -1, step: 1 });
    expect(nodeKeyCommand(key('ArrowRight'))).toEqual({ kind: 'nudge', axis: 'normal', sign: 1, step: 1 });
    expect(nodeKeyCommand(key('ArrowLeft'))).toEqual({ kind: 'nudge', axis: 'normal', sign: -1, step: 1 });
    expect(nodeKeyCommand(key('ArrowUp', { altKey: true }))).toEqual({ kind: 'nudge', axis: 'radial', sign: 1, step: 1 });
    expect(nodeKeyCommand(key('ArrowDown', { altKey: true }))).toEqual({ kind: 'nudge', axis: 'radial', sign: -1, step: 1 });
  });

  it('scales the step with Shift and fine tune', () => {
    expect(nodeKeyCommand(key('ArrowUp', { shiftKey: true }))).toMatchObject({ step: 10 });
    expect(nodeKeyCommand(key('ArrowUp'), true)).toMatchObject({ step: 0.1 });
    expect(nodeKeyCommand(key('ArrowUp', { shiftKey: true }), true)).toMatchObject({ step: 1 });
  });

  it('cycles nodes with Alt+left/right and leaves Ctrl/Cmd chords and other keys alone', () => {
    expect(nodeKeyCommand(key('ArrowRight', { altKey: true }))).toEqual({ kind: 'cycle', dir: 1 });
    expect(nodeKeyCommand(key('ArrowLeft', { altKey: true }))).toEqual({ kind: 'cycle', dir: -1 });
    expect(nodeKeyCommand(key('ArrowUp', { ctrlKey: true }))).toBeNull();
    expect(nodeKeyCommand(key('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(nodeKeyCommand(key('KeyW'))).toBeNull();
  });

  it('cycles node ids in time order, wrapping, starting at the next or last burn', () => {
    const nodes = [{ id: 7, time: 300 }, { id: 3, time: 100 }, { id: 5, time: 200 }];
    expect(cycleNodeId(nodes, null, 1)).toBe(3);
    expect(cycleNodeId(nodes, null, -1)).toBe(7);
    expect(cycleNodeId(nodes, 3, 1)).toBe(5);
    expect(cycleNodeId(nodes, 7, 1)).toBe(3);
    expect(cycleNodeId(nodes, 3, -1)).toBe(7);
    expect(cycleNodeId(nodes, 99, 1)).toBe(3);
    expect(cycleNodeId([], null, 1)).toBeNull();
  });

  it('keeps repeated fine steps free of float noise', () => {
    let v = 0;
    for (let i = 0; i < 3; i++) v = nudged(v, 1, 0.1);
    expect(v).toBe(0.3);
    expect(nudged(10, -1, 10)).toBe(0);
  });

  it('documents every node key in the map help', () => {
    const text = mapKeyHelp('Tab', 'Home').map(r => r.join(' ')).join('\n');
    for (const s of ['prograde', 'normal', 'radial', 'Next / previous node', 'Delete', 'Tab']) expect(text).toContain(s);
  });
});
