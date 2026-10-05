"""Refresh orbital elements from JPL Horizons at J2000; physical SBDB snapshot is separate."""
import json, math, urllib.parse, urllib.request
from pathlib import Path
records = [('vesta', '4;'), ('pallas', '2;'), ('hygiea', '10;'), ('bennu', '101955;'), ('ryugu', '162173;'), ('itokawa', '25143;'), ('eros', '433;'), ('psyche', '16;'), ('halley', '90000030;'), ('67p', '90000700;')]
path = Path('src/data/smallBodies.ts')
text = path.read_text()
rows = [json.loads(line.strip().rstrip(',')) for line in text.splitlines() if line.startswith('  {')]
snapshot = {}
for name, command in records:
    params = dict(format='json', COMMAND=repr(command), CENTER="'500@10'", EPHEM_TYPE="'ELEMENTS'", TLIST="'2451545.0'", OUT_UNITS="'KM-S'", REF_PLANE="'ECLIPTIC'", CSV_FORMAT="'YES'")
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(params)
    data = json.load(urllib.request.urlopen(url))
    result = data['result']
    row = result.split('$$SOE\n')[1].split('\n$$EOE')[0].strip().split(',')
    values = [float(v) for v in row[2:-1]]
    e, q, inc, node, peri, tp, n, ma, ta, a, ad, period = values
    body = next(b for b in rows if b['id'] == name)
    body['orbit'] = dict(a=a * 1000, e=e, i=math.radians(inc), lan=math.radians(node), argPe=math.radians(peri), meanAnomalyAtEpoch=math.radians(ma), epoch=0, frame='ecliptic')
    snapshot[name] = dict(url=url, result=result)
    print(name, period / (365.25 * 86400))
Path('docs/data/small-bodies-horizons.json').write_text(json.dumps(snapshot, indent=2) + '\n')
header = text.split('export const SMALL_BODY_DEFS')[0].replace('source osculation epochs retained (seconds since J2000).', 'osculating elements at JD 2451545.0 TDB from Horizons.')
path.write_text(header + 'export const SMALL_BODY_DEFS: BodyDef[] = [\n' + ''.join('  '+json.dumps(b, ensure_ascii=False)+',\n' for b in rows) + '];\n')
