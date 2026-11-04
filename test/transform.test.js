import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, zones, transform, localParts } from './helpers.js';

const tzOf = Object.fromEntries(zones.map((z) => [z.key, z.tz]));
const AT = '2026-11-03T10:15:00Z'; // 11:15 CET, the moment the fixtures were recorded around
const slots = (name, args) => JSON.parse(transform(fixture(name), { fn: 'slots', ...args }));
const summary = (name, args = {}, at = AT) => {
  const compact = transform(fixture(name), { fn: 'slots' });
  return JSON.parse(transform(compact, { fn: 'summary', at, ...args }));
};

test('fn=slots: DE answer -> hourly slots on the right instants, EUR/kWh', () => {
  const r = fixture('de');
  const c = slots('de');
  assert.equal(c.z, 'de');
  assert.equal(c.u, 'EUR/kWh');
  const expected = new Map();
  for (const d of r.days) for (const p of d.prices) expected.set(`${d.date}|${p.hour}`, Math.round(p.eur_mwh * 100) / 100000);
  assert.equal(c.s.length, expected.size);
  for (const [start, price, f] of c.s) {
    const l = localParts(start, tzOf.de);
    assert.equal(price, expected.get(`${l.date}|${l.hour}`));
    assert.equal(f, r.days.find((d) => d.date === l.date).type === 'forecast' ? 1 : 0);
  }
  for (let i = 1; i < c.s.length; i++) assert.equal(c.s[i][0], c.s[i - 1][0] + 3600);
});

test('fn=slots: PL in PLN with the ECB rate, in EUR with cur=eur; SE3 SEK; GB GBP', () => {
  const r = fixture('pl');
  const row = r.days[2].prices[11].eur_mwh;
  const pln = slots('pl');
  assert.equal(pln.u, 'PLN/kWh');
  const t = Date.parse('2026-11-03T10:00:00Z') / 1000;
  assert.equal(pln.s.find((s) => s[0] === t)[1], Math.round(((row * r.zoneInfo.rate) / 1000) * 1e5) / 1e5);
  const eur = slots('pl', { cur: 'eur' });
  assert.equal(eur.u, 'EUR/kWh');
  assert.equal(eur.s.find((s) => s[0] === t)[1], Math.round(row * 100) / 100000);
  assert.equal(slots('se3').u, 'SEK/kWh');
  assert.equal(slots('gb').u, 'GBP/kWh');
  assert.equal(slots('gb', { cur: 'eur' }).u, 'GBP/kWh');
});

test('fn=slots: GB leaves out the hours without a price', () => {
  const r = fixture('gb');
  const nulls = r.days.flatMap((d) => d.prices).filter((p) => p.eur_mwh == null).length;
  const total = r.days.reduce((n, d) => n + d.prices.length, 0);
  assert.equal(slots('gb').s.length, total - nulls);
});

test('fn=slots: Danish /api/forecast keeps DKK/kWh and marks the model days', () => {
  const c = slots('dk1_fc');
  assert.equal(c.z, 'dk1');
  assert.equal(c.u, 'DKK/kWh');
  assert.equal(c.s.length, 240);
  assert.deepEqual(c.s[0], [Date.parse('2026-11-02T23:00:00Z') / 1000, 2.209, 0]);
  assert.equal(c.s[24][2], 1);
  assert.equal(slots('dk2_net').z, 'dk2');
});

// --- daylight saving, every zone ------------------------------------------------------------------
test('every zone: 23 hours on 2026-03-29, 25 on 2026-10-25, hours land where Intl puts them', () => {
  const dates = ['2026-01-15', '2026-03-28', '2026-03-29', '2026-03-30', '2026-07-15', '2026-10-24', '2026-10-25', '2026-10-26'];
  for (const z of zones) {
    const days = dates.map((date, n) => ({ date, type: 'actual', prices: Array.from({ length: 24 }, (_, hour) => ({ hour, eur_mwh: n * 100 + hour })) }));
    const c = JSON.parse(transform({ zone: z.key, unit: 'EUR/MWh', zoneInfo: { currency: 'EUR', rate: 1 }, days }, { fn: 'slots' }));
    const per = new Map();
    for (const [start, price] of c.s) {
      const l = localParts(start, z.tz);
      const idx = dates.indexOf(l.date);
      assert.ok(idx >= 0, `${z.key} ${start}`);
      assert.equal(Math.round(price * 1000), idx * 100 + l.hour, `${z.key} ${new Date(start * 1000).toISOString()}`);
      per.set(l.date, (per.get(l.date) || 0) + 1);
    }
    for (const d of dates) assert.equal(per.get(d), d === '2026-03-29' ? 23 : d === '2026-10-25' ? 25 : 24, `${z.key} ${d}`);
  }
});

test('DST sweep 2025-2030 for four zones: every slot on the hour it was published for', () => {
  for (const z of ['de', 'gr', 'gb', 'pt']) {
    const days = [];
    for (let t = Date.parse('2025-01-01T00:00:00Z'), n = 0; t < Date.parse('2031-01-01T00:00:00Z'); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const md = date.slice(5);
      if (!((md >= '03-22' && md <= '04-02') || (md >= '10-22' && md <= '11-02'))) continue;
      days.push({ date, type: 'actual', prices: Array.from({ length: 24 }, (_, hour) => ({ hour, eur_mwh: n * 100 + hour })) });
      n++;
    }
    const c = JSON.parse(transform({ zone: z, unit: 'EUR/MWh', zoneInfo: { currency: 'EUR', rate: 1 }, days }, { fn: 'slots' }));
    const tz = tzOf[z];
    for (const [start, price] of c.s) {
      const l = localParts(start, tz);
      const idx = days.findIndex((d) => d.date === l.date);
      assert.equal(Math.round(price * 1000), idx * 100 + l.hour, `${z} ${new Date(start * 1000).toISOString()}`);
    }
  }
});

test('fi is on Helsinki time: hour 0 of 2026-11-03 is 22:00Z (ENTSO-E market day starts at 23:00Z = hour 1), summer 21:00Z', () => {
  assert.equal(tzOf.fi, 'Europe/Helsinki');
  const day = (date) => ({ date, type: 'actual', prices: Array.from({ length: 24 }, (_, hour) => ({ hour, eur_mwh: hour === 1 ? 5.77 : hour })) });
  const fi = (date) => JSON.parse(transform({ zone: 'fi', unit: 'EUR/MWh', zoneInfo: { currency: 'EUR', rate: 1 }, days: [day(date)] }, { fn: 'slots' }));
  const winter = fi('2026-11-03');
  assert.equal(winter.o, 2);
  assert.equal(winter.s.length, 24);
  assert.equal(winter.s[0][0], Date.parse('2026-11-02T22:00:00Z') / 1000);
  assert.equal(winter.s[1][0], Date.parse('2026-11-02T23:00:00Z') / 1000); // first ENTSO-E market hour
  assert.equal(winter.s[1][1], 0.00577);
  assert.equal(winter.s[23][0], Date.parse('2026-11-03T21:00:00Z') / 1000);
  assert.equal(fi('2026-07-15').s[0][0], Date.parse('2026-07-14T21:00:00Z') / 1000);
  // Copenhagen zones stay one hour later than Helsinki
  const dk = JSON.parse(transform({ zone: 'se3', unit: 'EUR/MWh', zoneInfo: { currency: 'EUR', rate: 1 }, days: [day('2026-11-03')] }, { fn: 'slots' }));
  assert.equal(dk.s[0][0], Date.parse('2026-11-02T23:00:00Z') / 1000);
});

// --- fn=summary ---------------------------------------------------------------------------------------
test('summary DK1: price now, next, level and today numbers equal the live API (min 2.209, max 3.0903)', () => {
  const s = summary('dk1_fc');
  assert.equal(s.price_now, 2.3166);
  assert.equal(s.price_next, 2.2758);
  assert.equal(s.price_type, 'actual');
  assert.equal(s.hour_start, '2026-11-03T10:00:00.000+0000');
  assert.equal(s.unit, 'DKK/kWh');
  assert.equal(s.level, 'cheap');
  assert.equal(s.today_min, 2.209);
  assert.equal(s.today_max, 3.0903);
  assert.equal(s.today_avg, 2.52244);
  assert.equal(s.cheapest_start, '2026-11-02T23:00:00.000+0000');
  assert.equal(s.priciest_start, '2026-11-03T16:00:00.000+0000');
  assert.equal(s.tomorrow_published, 'OFF');
  assert.equal(s.stale, 'OFF');
});

test('summary DK1 matches /api/now and the live /api/schedule (4 cheapest hours of today)', () => {
  const now = fixture('now');
  const sched = fixture('sched');
  // /api/now was recorded at 08:40 CET = 07:40Z
  assert.equal(summary('dk1_fc', {}, '2026-11-03T07:40:00Z').price_now, now.price);
  const onHours = sched.schedule.filter((x) => x.on).map((x) => x.hour);
  const c = JSON.parse(transform(transform(fixture('dk1_fc'), { fn: 'slots' }), { fn: 'summary', at: AT, scope: 'today', cheap: 4 }));
  assert.equal(c.cheap_now, 'OFF'); // 11:15 is not among hours 0-3
  const inHour = (h) => `2026-11-03T${String(h - 1).padStart(2, '0')}:20:00Z`; // local hour h (CET) = h-1 UTC
  for (let h = 0; h < 24; h++) {
    const at = h === 0 ? '2026-11-02T23:20:00Z' : inHour(h);
    const r = JSON.parse(transform(transform(fixture('dk1_fc'), { fn: 'slots' }), { fn: 'summary', at, scope: 'today', cheap: 4 }));
    assert.equal(r.cheap_now === 'ON', onHours.includes(h), `hour ${h}`);
  }
});

// independent reference: the priced hours of the fixture as [startSeconds, price, isForecast]
function reference(name) {
  const r = fixture(name);
  const out = [];
  for (const [date, d] of r.days.map((d) => [d.date, d])) {
    for (const p of d.prices) {
      const price = name.startsWith('dk') ? p.price : p.eur_mwh * 1; // callers pass DK fixtures only
      if (price === null || price === undefined) continue;
      out.push({ date, hour: p.hour, price, f: d.type === 'forecast' ? 1 : 0 });
    }
  }
  return out;
}
const dk1 = reference('dk1_fc');
const startOf = (date, hour) => {
  // Copenhagen local hour -> unix seconds (no clock change in these dates: CET = UTC+1 from 2026-10-25)
  return Date.parse(`${date}T00:00:00Z`) / 1000 + hour * 3600 - 3600;
};
const NOW_S = Date.parse(AT) / 1000;
const horizonRef = (hours, forecast) =>
  dk1
    .map((x) => ({ start: startOf(x.date, x.hour), price: x.price, f: x.f }))
    .filter((x) => x.start >= Math.floor(NOW_S / 3600) * 3600 && x.start < Math.floor(NOW_S / 3600) * 3600 + hours * 3600 && (forecast || x.f === 0));

test('summary: the 4 cheapest of the next 24 hours, published prices only (the rest of today)', () => {
  const ref = horizonRef(24, false);
  assert.equal(ref.length, 13); // 11:00..23:00 CET today
  const want = ref.slice().sort((a, b) => a.price - b.price || a.start - b.start).slice(0, 4).sort((a, b) => a.start - b.start);
  const a = summary('dk1_fc', { cheap: 4, horizon: 24 });
  assert.equal(a.cheap_count, 4);
  assert.equal(a.cheap_forecast_based, 'OFF');
  assert.equal(a.cheap_next_start, new Date(want.find((x) => x.start > NOW_S).start * 1000).toISOString().replace('Z', '+0000'));
  assert.equal(a.cheap_now, want.some((x) => x.start <= NOW_S && NOW_S < x.start + 3600) ? 'ON' : 'OFF');
});

test('summary: with forecast=1 the horizon reaches into the model days and says so', () => {
  const ref = horizonRef(24, true);
  assert.equal(ref.length, 24);
  const want = ref.slice().sort((a, b) => a.price - b.price || a.start - b.start).slice(0, 6);
  const a = summary('dk1_fc', { cheap: 6, horizon: 24, forecast: 1 });
  assert.equal(a.cheap_count, 6);
  assert.equal(a.cheap_forecast_based, want.some((x) => x.f === 1) ? 'ON' : 'OFF');
});

test('summary: cheapest run of 3 hours in a row (lowest sum), compared with brute force', () => {
  const ref = horizonRef(24, false);
  let best = null;
  for (let i = 0; i + 3 <= ref.length; i++) {
    const sum = ref[i].price + ref[i + 1].price + ref[i + 2].price;
    if (best === null || sum < best.sum) best = { i, sum };
  }
  const a = summary('dk1_fc', { run: 3, horizon: 24 });
  assert.equal(a.run_start, new Date(ref[best.i].start * 1000).toISOString().replace('Z', '+0000'));
  assert.equal(a.run_end, new Date((ref[best.i + 2].start + 3600) * 1000).toISOString().replace('Z', '+0000'));
  assert.ok(Math.abs(a.run_avg - best.sum / 3) < 1e-4);
});

test('summary: maxprice keeps expensive hours out; nothing qualifies -> UNDEF / OFF', () => {
  const a = summary('dk1_fc', { cheap: 4, horizon: 24, maxprice: 1 });
  assert.equal(a.cheap_count, 0);
  assert.equal(a.cheap_now, 'OFF');
  assert.equal(a.cheap_next_start, 'UNDEF');
  assert.equal(a.run_start, 'UNDEF');
});

test('summary: tomorrow_published is ON once the next day has published prices', () => {
  const r = fixture('de');
  r.days.find((d) => d.date === '2026-11-04').type = 'actual';
  const c = transform(r, { fn: 'slots' });
  assert.equal(JSON.parse(transform(c, { fn: 'summary', at: AT })).tomorrow_published, 'ON');
});

test('summary: GB has no price for the hour yet -> last complete hour, stale ON, no next hour', () => {
  const s = summary('gb', {}, '2026-11-03T08:10:00Z');
  assert.equal(s.stale, 'ON');
  assert.equal(typeof s.price_now, 'number');
  assert.equal(s.price_next, 'UNDEF');
  const late = summary('gb', {}, '2026-11-03T22:10:00Z');
  assert.equal(late.price_now, 'UNDEF');
  assert.equal(late.level, 'UNDEF');
});

test('summary: other zones (units follow the zone)', () => {
  assert.equal(summary('de').unit, 'EUR/kWh');
  assert.equal(summary('pl').unit, 'PLN/kWh');
  assert.equal(summary('se3').unit, 'SEK/kWh');
  assert.equal(typeof summary('de').price_now, 'number');
});

test('fn=list: the hourly price list for charts, from now / from midnight, forecast on or off', () => {
  const compact = transform(fixture('dk1_fc'), { fn: 'slots' });
  const a = JSON.parse(transform(compact, { fn: 'list', at: AT, hours: 48, forecast: 1 }));
  assert.equal(a.length, 48);
  assert.deepEqual(a[0], { start: '2026-11-03T10:00:00Z', price: 2.3166, type: 'actual' });
  assert.equal(a[13].type, 'forecast');
  const b = JSON.parse(transform(compact, { fn: 'list', at: AT, hours: 48, forecast: 0 }));
  assert.equal(b.length, 13);
  const c = JSON.parse(transform(compact, { fn: 'list', at: AT, hours: 24, from: 'today' }));
  assert.equal(c[0].start, '2026-11-02T23:00:00Z');
  assert.equal(c.length, 24);
});

test('errors are thrown (openHAB logs them): unknown fn, answer that is not price data, summary on a raw answer', () => {
  assert.throws(() => transform('{}', { fn: 'nope' }), /unknown fn/);
  assert.throws(() => transform('{}', { fn: 'slots' }), /no days/);
  assert.throws(() => transform(fixture('de'), { fn: 'summary' }), /slot list/);
});

test('without arguments fn defaults to summary (so JS(elpriser.js) works on a slot list)', () => {
  const compact = transform(fixture('dk1_fc'), { fn: 'slots' });
  assert.equal(JSON.parse(transform(compact, { at: AT })).price_now, 2.3166);
});

test('the compact list of a 10-day DK1 answer is small enough for a String item', () => {
  assert.ok(transform(fixture('dk1_fc'), { fn: 'slots' }).length < 8000);
});
