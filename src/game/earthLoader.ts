import { installEarthData } from '../sim/terrain/earthData';
let loading: Promise<void> | undefined;
/** Browser/worker host adapter. Fetch once, before simulation or render creation; PWA precaches the file. */
export function loadEarthData(): Promise<void> {
  return loading ??= (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}earth/height.i16`);
    if (!response.ok) throw new Error(`Earth geography could not load (${response.status}). Please reload when online.`);
    const bytes = await response.arrayBuffer();
    if (typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated) {
      const shared = new SharedArrayBuffer(bytes.byteLength);
      new Uint8Array(shared).set(new Uint8Array(bytes));
      installEarthData(shared);
    } else installEarthData(bytes);
  })();
}
