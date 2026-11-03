// Runs conf/transform/elpriser.js on the LIVE service for every zone. Skipped unless ELPRISER_LIVE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zones, transform } from './helpers.js';

const live = process.env.ELPRISER_LIVE === '1';
const get = async (path) => {
  const r = await fetch('https://elpriser.org' + path, { headers: { 'User-Agent': 'openhab-elpriser-tests/0.1' } });
  assert.equal(r.status, 200, path);
  return r.text();
};
const url = (z) => (z === 'dk1' || z === 'dk2' ? `/api/forecast?area=${z.toUpperCase()}&mode=inkl_alt` : `/api/nordic?zone=${z}`);

test('DK1 price now equals /api/now', { skip: !live }, async () => {
  const slots = transform(await get(url('dk1')), { fn: 'slots' });
  const s = JSON.parse(transform(slots, { fn: 'summary' }));
  const now = JSON.parse(await get('/api/now?area=DK1&mode=inkl_alt'));
  assert.ok(Math.abs(s.price_now - now.price) < 1e-4, `${s.price_now} vs ${now.price}`);
});

for (const z of zones.map((x) => x.key)) {
  test(`${z}: slots -> summary has a price for the current hour`, { skip: !live }, async () => {
    const slots = transform(await get(url(z)), { fn: 'slots' });
    const s = JSON.parse(transform(slots, { fn: 'summary' }));
    assert.equal(typeof s.price_now, 'number', JSON.stringify(s));
    assert.match(s.unit, /^[A-Z]{3}\/kWh$/);
    assert.ok(['cheap', 'normal', 'expensive'].includes(s.level));
    assert.ok(JSON.parse(transform(slots, { fn: 'list', hours: 24, forecast: 1 })).length > 0);
  });
}
