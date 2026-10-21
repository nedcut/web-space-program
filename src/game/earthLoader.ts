import { EARTH_DATA_BYTES, EARTH_FILES, earthData, installEarthData } from '../sim/terrain/earthData';
let loading: Promise<void> | undefined;
/** The fetched files, kept so workers can read the grid without a 16 MiB copy on this thread. */
let fetched: { blob: Blob; buffer: ArrayBufferLike } | undefined;
/** Browser/worker host adapter. Fetch once, before simulation or render creation; PWA precaches the file. */
export function loadEarthData(onProgress?: (received: number, total: number) => void): Promise<void> {
  if (loading) return loading;
  const controller = new AbortController();
  let received = 0;
  onProgress?.(received, EARTH_DATA_BYTES);
  loading = (async () => {
    const parts = await Promise.all(EARTH_FILES.map(async (file) => {
      const response = await fetch(`${import.meta.env.BASE_URL}earth/${file.path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Earth geography could not load (HTTP ${response.status}).`);
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > file.bytes) throw new Error('Earth geography has an unexpected size.');
            chunks.push(value);
            if (!controller.signal.aborted) {
              received += value.byteLength;
              onProgress?.(received, EARTH_DATA_BYTES);
            }
          }
        } finally { reader.releaseLock(); }
      } else {
        const bytes = await response.arrayBuffer();
        size = bytes.byteLength;
        chunks.push(new Uint8Array(bytes));
        if (!controller.signal.aborted) {
          received += size;
          onProgress?.(received, EARTH_DATA_BYTES);
        }
      }
      if (size !== file.bytes) throw new Error('Earth geography is incomplete.');
      return new Blob(chunks);
    }));
    const blob = new Blob(parts);
    const bytes = await blob.arrayBuffer();
    if (typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated) {
      const shared = new SharedArrayBuffer(bytes.byteLength);
      new Uint8Array(shared).set(new Uint8Array(bytes));
      installEarthData(shared);
    } else {
      installEarthData(bytes);
      fetched = { blob, buffer: bytes };
    }
  })().catch((error: unknown) => {
    controller.abort();
    loading = undefined;
    throw error;
  });
  return loading;
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
