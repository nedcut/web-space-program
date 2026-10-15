import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [{ path, bytes: (await stat(path)).size }];
  }));
  return groups.flat();
}

const files = (await filesIn('dist')).sort((a, b) => b.bytes - a.bytes);
console.log(`${files.length} files; largest assets:`);
for (const file of files.slice(0, 10)) console.log(`${(file.bytes / 2 ** 20).toFixed(2)} MiB  ${file.path}`);
if (files.length > 20_000 || files.some(file => file.bytes > 25 * 2 ** 20)) {
  throw new Error('Cloudflare Pages limit exceeded: 20,000 files / 25 MiB per file');
}
