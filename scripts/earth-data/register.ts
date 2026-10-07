/** Node host bootstrap. CLI: node --import tsx --import ./scripts/earth-data/register.ts your-script.ts */
import { readFileSync } from 'node:fs';
import { installEarthData } from '../../src/sim/terrain/earthData';
const bytes = readFileSync(new URL('../../public/earth/height.i16', import.meta.url));
installEarthData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
