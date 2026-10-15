/** Node host bootstrap. CLI: node --import tsx --import ./scripts/earth-data/register.ts your-script.ts */
import { readFileSync } from 'node:fs';
import { EARTH_FILES, installEarthData } from '../../src/sim/terrain/earthData';
const bytes = Buffer.concat(EARTH_FILES.map(file => readFileSync(new URL(`../../public/earth/${file.path}`, import.meta.url))));
installEarthData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
