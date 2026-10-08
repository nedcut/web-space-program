import { earthData, installEarthData } from '../sim/terrain/earthData';
let loading: Promise<void> | undefined;
/** The fetched file, kept so workers can read the grid without a 16 MiB copy on this thread. */
let fetched: { blob: Blob; buffer: ArrayBufferLike } | undefined;
/** Browser/worker host adapter. Fetch once, before simulation or render creation; PWA precaches the file. */
export function loadEarthData(): Promise<void> {
  return loading ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}earth/height.i16`);
    if (!response.ok) throw new Error(`Earth geography could not load (${response.status}). Please reload when online.`);
    const blob = await response.blob();
    const bytes = await blob.arrayBuffer();
    if (typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated) {
      const shared = new SharedArrayBuffer(bytes.byteLength);
      new Uint8Array(shared).set(new Uint8Array(bytes));
      installEarthData(shared);
    } else {
      installEarthData(bytes);
      fetched = { blob, buffer: bytes };
    }
  })();
}

/**
 * Worker message fields for the installed grid. Structured-cloning an ArrayBuffer copies all 16 MiB synchronously
 * (~15 ms, e.g. when landing prediction starts during a fall); a Blob shares its immutable backing store and the
 * worker materialises it off this thread. Shared grids are posted as-is.
 */
export function earthDataMessage(): { blob: Blob; buffer?: never } | { buffer: ArrayBufferLike; blob?: never } {
  const buffer = earthData().buffer;
  if (!(buffer instanceof ArrayBuffer)) return { buffer };
  if (fetched?.buffer !== buffer) fetched = { blob: new Blob([buffer]), buffer };
  return { blob: fetched.blob };
}
