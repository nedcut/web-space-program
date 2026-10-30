import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_MODES, traceHash } from '../scripts/bench/determinism';

afterEach(() => vi.restoreAllMocks());

describe('fixed-tick golden mission traces', () => {
  for (const craft of ['stock-kestrel', 'stock-selene']) for (const mode of TRACE_MODES) {
    it(`${craft}/${mode} hashes every serialized tick identically in independent runs`, () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      const first = traceHash(craft, mode);
      expect(traceHash(craft, mode), `${craft}/${mode}, dt=0.02, ticks=100`).toBe(first);
      // Ensure the digest includes the evolving trace, rather than only a constant snapshot.
      expect(traceHash(craft, mode, 99)).not.toBe(first);
    });
  }
});
