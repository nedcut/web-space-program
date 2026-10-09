/** Worker message fields for the installed Earth grid (`{ blob }` shares an immutable backing store). */
export type EarthDataMessage = { blob: Blob; buffer?: never } | { buffer: ArrayBufferLike; blob?: never };

let source: (() => EarthDataMessage) | undefined;

/**
 * The host (which fetched the grid) supplies its cached message so terrain workers reuse the fetched Blob instead
 * of the render layer copying the 16 MiB grid into a second Blob on the main thread.
 */
export function setEarthDataSource(provider: () => EarthDataMessage): void {
  source = provider;
}

export function earthDataSource(): (() => EarthDataMessage) | undefined {
  return source;
}
