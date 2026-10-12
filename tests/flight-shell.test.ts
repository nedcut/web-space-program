import { describe, expect, it, vi } from 'vitest';
import { pauseMenuGroups, type PauseMenuModel } from '../src/flight/hud/PauseMenu';
import { appEscapeEngaged } from '../src/flight/hud/AppLauncher';
import { flightExitNotice } from '../src/flight/exit';
import { createEscapeStack } from '../src/ui/nav/escape';
import type { FlightRecord } from '../src/game/flightlog/recorder';

const base: PauseMenuModel = { lost: false, practice: null, canRecover: false, canRevert: true, hasQuicksave: true };
const items = (m: Partial<PauseMenuModel>) => Object.fromEntries(pauseMenuGroups({ ...base, ...m }).map(g => [g.id, g.items]));

describe('pause menu groups', () => {
  it('groups a launched flight as Flight · Program · Options', () => {
    expect(items({ canRecover: true })).toEqual({
      flight: ['revertLaunch', 'revertEditor', 'recover'],
      program: ['quicksave', 'saveAs', 'quickload'],
      options: ['photo', 'controls', 'settings'],
    });
  });

  it('offers no reverts for a resumed flight and no quickload without a quicksave', () => {
    expect(items({ canRevert: false, hasQuicksave: false })).toEqual({ program: ['quicksave', 'saveAs'], options: ['photo', 'controls', 'settings'] });
  });

  it('lessons and challenges only restart: no recover, revert to editor or saves', () => {
    for (const practice of ['lesson', 'challenge'] as const) {
      expect(items({ practice, canRecover: true })).toEqual({ flight: ['restart'], options: ['photo', 'controls', 'settings'] });
    }
  });

  it('a lost vessel keeps the ways back but drops saving and photo mode', () => {
    expect(items({ lost: true })).toEqual({ flight: ['revertLaunch', 'revertEditor'], options: ['controls', 'settings'] });
  });
});

describe('app window Escape engagement', () => {
  it('engages on a click in the apps and releases on a click in the scene', () => {
    expect(appEscapeEngaged(false, { kind: 'pointer', inApps: true })).toBe(true);
    expect(appEscapeEngaged(true, { kind: 'pointer', inApps: false })).toBe(false);
  });

  it('any flight key hands Esc back to the pause menu; Esc, modifiers and typing do not', () => {
    const key = (key: string, extra: { typing?: boolean; appKey?: boolean } = {}) => ({ kind: 'key' as const, key, typing: false, appKey: false, ...extra });
    expect(appEscapeEngaged(true, key(' '))).toBe(false);
    expect(appEscapeEngaged(true, key('w'))).toBe(false);
    expect(appEscapeEngaged(true, key('Escape'))).toBe(true);
    expect(appEscapeEngaged(true, key('Shift'))).toBe(true);
    expect(appEscapeEngaged(true, key('a', { typing: true }))).toBe(true);
    expect(appEscapeEngaged(false, key('F3', { appKey: true }))).toBe(true);
  });
});

describe('flight Escape order', () => {
  const esc = () => ({ key: 'Escape', target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  it('closes a confirmation, then the pause menu, before app windows', () => {
    const stack = createEscapeStack(), calls: string[] = [];
    const app = stack.push(() => calls.push('app'), 'panel');
    const pause = stack.push(() => calls.push('pause'), 'modal');
    const confirm = stack.push(() => calls.push('confirm'), 'modal');
    stack.handle(esc()); confirm();
    stack.handle(esc()); pause();
    stack.handle(esc()); app();
    expect(calls).toEqual(['confirm', 'pause', 'app']);
    // Nothing registered: Esc falls through to the flight controller (pause).
    expect(stack.handle(esc())).toBe(false);
  });

  it('F3 results consume Esc instead of also opening the pause menu', () => {
    const stack = createEscapeStack();
    const run = vi.fn();
    stack.push(run, 'modal');
    const e = esc();
    expect(stack.handle(e)).toBe(true);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('flight exit notice', () => {
  const record = { id: 'r1', name: 'Meridian Orbiter', stats: { maxAltitude: 85_200, maxSpeed: 0, maxG: 0, dvSpent: 0, distance: 0 } } as FlightRecord;
  it('points the hub at the flight report', () => {
    expect(flightExitNotice({ latestReportId: 'r1', flightlog: { records: [record] } }, null)).toMatch(/^Meridian Orbiter: flight report in the Flight Log \(max altitude 85\.2 km\)$/);
  });
  it('extends a recovery summary and keeps it when there is no report', () => {
    expect(flightExitNotice({ latestReportId: 'r1', flightlog: { records: [record] } }, 'Meridian Orbiter recovered')).toBe('Meridian Orbiter recovered · report in the Flight Log');
    expect(flightExitNotice({ latestReportId: null, flightlog: { records: [] } }, 'x')).toBe('x');
  });
});
