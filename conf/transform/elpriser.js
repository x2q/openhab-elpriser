// elpriser.org for openHAB: JS transformation (needs the "JavaScript Scripting" add-on).
//
// Usage (see README): JS(elpriser.js?fn=<function>&<arguments>) with the text of an elpriser.org answer or of
// the compact slot list as the input.
//
//   fn=slots     answer of /api/nordic or /api/forecast  ->  compact slot list (absolute UTC times)
//   fn=summary   compact slot list  ->  JSON with price now / next, level, today's min/max/average, cheapest
//                hours, cheapest run, ...  (extract the fields with JSONPATH)
//   fn=list      compact slot list  ->  JSON array [{start, price, type}] for charts
//
// Arguments (all optional): cheap=4 (N cheapest hours), horizon=24 (look at the next H hours) or scope=today
// (the zone's calendar day, hours that have passed included), run=3 (length of
// the cheapest run of hours), forecast=0|1 (also use model-forecast hours), maxprice=<per kWh>, cur=local|eur
// (fn=slots), hours=48 and from=now|today (fn=list), at=<ISO 8601> (pretend it is that moment, for tests).
//
// No time zone database is needed: the zones of elpriser.org all follow the EU daylight-saving rule, only the
// winter offset differs. Plain JavaScript, no openHAB API.
(function (data) {
  'use strict';

  var HOUR = 3600;

  // ---- arguments (injected as variables by the JS transformation) --------------------------------------
  function str(v, d) { return v === undefined ? d : String(v); }
  function intOf(v, d) { var n = parseInt(v, 10); return isFinite(n) ? n : d; }
  var A = {
    fn: str(typeof fn !== 'undefined' ? fn : undefined, 'summary'),
    cheap: intOf(typeof cheap !== 'undefined' ? cheap : undefined, 4),
    horizon: intOf(typeof horizon !== 'undefined' ? horizon : undefined, 24),
    scope: str(typeof scope !== 'undefined' ? scope : undefined, 'next'),
    run: intOf(typeof run !== 'undefined' ? run : undefined, 3),
    forecast: intOf(typeof forecast !== 'undefined' ? forecast : undefined, 0) === 1,
    maxprice: (typeof maxprice !== 'undefined' && maxprice !== '' && isFinite(Number(maxprice))) ? Number(maxprice) : null,
    cur: str(typeof cur !== 'undefined' ? cur : undefined, 'local'),
    hours: intOf(typeof hours !== 'undefined' ? hours : undefined, 48),
    from: str(typeof from !== 'undefined' ? from : undefined, 'now'),
    at: str(typeof at !== 'undefined' ? at : undefined, '')
  };

  // ---- time: EU daylight saving, no time zone database ---------------------------------------------------
  var WINTER = { pt: 0, gb: 0, ie: 0, gr: 2, ro: 2, bg: 2, ee: 2, lv: 2, lt: 2 }; // every other zone: CET
  function winterOffset(zone) { return WINTER.hasOwnProperty(zone) ? WINTER[zone] : 1; }

  // 01:00 UTC on the last Sunday of the 31-day month m (3 or 10), in unix seconds
  function lastSunday(y, m) {
    var t = Date.UTC(y, m - 1, 31, 1) / 1000;
    return t - new Date(t * 1000).getUTCDay() * 86400;
  }
  function dst(u) { // 1 while summer time is in force at unix time u
    var y = new Date(u * 1000).getUTCFullYear();
    return (u >= lastSunday(y, 3) && u < lastSunday(y, 10)) ? 1 : 0;
  }
  function offsetAt(u, b) { return b + dst(u); } // hours east of UTC
  function midnight(date, b) { // unix time of 00:00 local on "YYYY-MM-DD" (never inside the clock change)
    var p = date.split('-');
    var n = Date.UTC(+p[0], +p[1] - 1, +p[2]) / 1000;
    return n - (b + dst(n - b * 3600)) * 3600;
  }
  function nextDate(date) { return new Date(Date.parse(date + 'T00:00:00Z') + 90000000).toISOString().slice(0, 10); }
  function localDate(u, b) { return new Date((u + offsetAt(u, b) * 3600) * 1000).toISOString().slice(0, 10); }
  function iso(u) { return new Date(u * 1000).toISOString().replace('.000Z', 'Z'); }
  function isoOh(u) { return new Date(u * 1000).toISOString().replace('Z', '+0000'); } // the form openHAB prints DateTime in
  function floorHour(u) { return Math.floor(u / HOUR) * HOUR; }
  function round5(v) { return Math.round(v * 100000) / 100000; }
  function nowSeconds() {
    if (A.at !== '') { var t = Date.parse(A.at); if (isFinite(t)) return Math.floor(t / 1000); }
    return Math.floor(Date.now() / 1000);
  }

  // ---- fn=slots: API answer -> compact slot list -------------------------------------------------------------
  function toSlots(text) {
    var r = JSON.parse(text);
    if (!r || !r.days || !r.days.length) throw new Error('elpriser: no days in the answer');
    var danish = r.area !== undefined && r.zone === undefined;
    var zone = danish ? String(r.area).toLowerCase() : String(r.zone);
    var b = winterOffset(zone);
    var scale, unit;
    if (danish) {
      scale = 1; unit = 'DKK/kWh';
    } else {
      var src = String(r.unit || 'EUR/MWh').split('/')[0];
      var local = A.cur !== 'eur';
      var rate = (r.zoneInfo && r.zoneInfo.rate) ? Number(r.zoneInfo.rate) : 1;
      scale = ((src === 'EUR' && local) ? rate : 1) / 1000;
      unit = (src === 'EUR' ? (local && r.zoneInfo && r.zoneInfo.currency ? r.zoneInfo.currency : 'EUR') : src) + '/kWh';
    }
    var out = [];
    for (var i = 0; i < r.days.length; i++) {
      var day = r.days[i];
      var byHour = {};
      for (var k = 0; k < day.prices.length; k++) {
        var row = day.prices[k];
        var v = danish ? row.price : row.eur_mwh;
        if (typeof v === 'number' && isFinite(v)) byHour[row.hour] = round5(v * scale);
      }
      var start = midnight(day.date, b);
      var end = midnight(nextDate(day.date), b);
      for (var t = start; t < end; t += HOUR) {
        var hour = Math.floor(((t + offsetAt(t, b) * 3600) % 86400) / 3600);
        if (byHour.hasOwnProperty(hour)) out.push([t, byHour[hour], day.type === 'forecast' ? 1 : 0]);
      }
    }
    out.sort(function (x, y) { return x[0] - y[0]; });
    // a later day wins on overlap (cannot happen with the real service, kept for safety)
    var dedup = [];
    for (var j = 0; j < out.length; j++) {
      if (dedup.length && dedup[dedup.length - 1][0] === out[j][0]) dedup[dedup.length - 1] = out[j]; else dedup.push(out[j]);
    }
    return JSON.stringify({ z: zone, o: b, u: unit, g: r.generated || null, s: dedup });
  }

  // ---- queries on the compact list --------------------------------------------------------------------------
  function load(text) {
    var d = JSON.parse(text);
    if (!d || !d.s) throw new Error('elpriser: input is not a slot list (use fn=slots on the API answer first)');
    return d;
  }
  function current(d, now) {
    var i, s;
    for (i = 0; i < d.s.length; i++) { s = d.s[i]; if (s[0] <= now && now < s[0] + HOUR) return { slot: s, stale: false }; }
    if (d.z === 'gb') { // only past hours are priced: the last complete hour, at most 3 hours old
      for (i = d.s.length - 1; i >= 0; i--) { s = d.s[i]; if (s[0] + HOUR <= now && now - (s[0] + HOUR) <= 3 * HOUR) return { slot: s, stale: true }; }
    }
    return { slot: null, stale: false };
  }
  function slotAfter(d, start) {
    for (var i = 0; i < d.s.length; i++) if (d.s[i][0] === start + HOUR) return d.s[i];
    return null;
  }
  function dayOf(d, now) {
    var date = localDate(now, d.o);
    var from = midnight(date, d.o), to = midnight(nextDate(date), d.o);
    return d.s.filter(function (s) { return s[0] >= from && s[0] < to; });
  }
  function stats(slots) {
    if (!slots.length) return null;
    var min = slots[0], max = slots[0], sum = 0;
    slots.forEach(function (s) { if (s[1] < min[1]) min = s; if (s[1] > max[1]) max = s; sum += s[1]; });
    return { min: min, max: max, avg: round5(sum / slots.length) };
  }
  function level(price, st) { // lowest third of today's range cheap, highest third expensive, a flat day normal
    if (price === null || !st) return 'UNDEF';
    var low = st.min[1], high = st.max[1], span = high - low;
    if (span <= 0 || span < 0.005 * Math.max(Math.abs(low), Math.abs(high))) return 'normal';
    var pos = (price - low) / span;
    return pos <= 1 / 3 ? 'cheap' : (pos >= 2 / 3 ? 'expensive' : 'normal');
  }
  function horizonSlots(d, now) { // scope=next: the current hour and the following ones; scope=today: the zone's calendar day
    var from = floorHour(now), to = from + A.horizon * HOUR;
    var base = A.scope === 'today' ? dayOf(d, now) : d.s;
    return base.filter(function (s) { return (A.scope === 'today' || (s[0] >= from && s[0] < to)) && (A.forecast || s[2] === 0); });
  }
  function cheapestHours(slots, n) {
    var c = slots.filter(function (s) { return A.maxprice === null || s[1] <= A.maxprice; });
    c.sort(function (x, y) { return x[1] - y[1] || x[0] - y[0]; });
    return c.slice(0, Math.max(0, n)).sort(function (x, y) { return x[0] - y[0]; });
  }
  function cheapestRun(slots, n) {
    var best = null;
    for (var i = 0; i + n <= slots.length; i++) {
      var sum = 0, ok = true;
      for (var j = 0; j < n; j++) {
        if (j > 0 && slots[i + j][0] !== slots[i + j - 1][0] + HOUR) { ok = false; break; }
        sum += slots[i + j][1];
      }
      if (!ok) continue;
      if (A.maxprice !== null && sum / n > A.maxprice) continue;
      if (best === null || sum < best.sum) best = { first: slots[i], last: slots[i + n - 1], sum: sum };
    }
    return best;
  }
  function onOff(b) { return b ? 'ON' : 'OFF'; }
  function undef(v) { return v === null || v === undefined ? 'UNDEF' : v; }

  function summary(d, now) {
    var cur = current(d, now);
    var price = cur.slot ? cur.slot[1] : null;
    var next = cur.slot && !cur.stale ? slotAfter(d, cur.slot[0]) : null;
    var st = stats(dayOf(d, now));
    var chosen = cheapestHours(horizonSlots(d, now), A.cheap);
    var nextChosen = null;
    for (var i = 0; i < chosen.length; i++) if (chosen[i][0] > now) { nextChosen = chosen[i]; break; }
    var run = cheapestRun(horizonSlots(d, now), A.run);
    var tomorrow = nextDate(localDate(now, d.o));
    var published = d.s.some(function (s) { return s[2] === 0 && localDate(s[0], d.o) === tomorrow; });
    return JSON.stringify({
      zone: d.z,
      unit: d.u,
      price_now: undef(price),
      price_next: undef(next ? next[1] : null),
      price_type: cur.slot ? (cur.slot[2] ? 'forecast' : 'actual') : 'UNDEF',
      hour_start: cur.slot ? isoOh(cur.slot[0]) : 'UNDEF',
      stale: onOff(cur.stale),
      level: level(price, st),
      today_min: st ? st.min[1] : 'UNDEF',
      today_max: st ? st.max[1] : 'UNDEF',
      today_avg: st ? st.avg : 'UNDEF',
      cheapest_start: st ? isoOh(st.min[0]) : 'UNDEF',
      priciest_start: st ? isoOh(st.max[0]) : 'UNDEF',
      cheap_now: onOff(chosen.some(function (s) { return s[0] <= now && now < s[0] + HOUR; })),
      cheap_next_start: nextChosen ? isoOh(nextChosen[0]) : 'UNDEF',
      cheap_count: chosen.length,
      cheap_forecast_based: onOff(chosen.some(function (s) { return s[2] === 1; })),
      run_start: run ? isoOh(run.first[0]) : 'UNDEF',
      run_end: run ? isoOh(run.last[0] + HOUR) : 'UNDEF',
      run_avg: run ? round5(run.sum / A.run) : 'UNDEF',
      run_now: onOff(!!run && run.first[0] <= now && now < run.last[0] + HOUR),
      tomorrow_published: onOff(published),
      generated: undef(d.g)
    });
  }

  function list(d, now) {
    var from = A.from === 'today' ? midnight(localDate(now, d.o), d.o) : floorHour(now);
    var to = A.hours > 0 ? from + A.hours * HOUR : Infinity;
    return JSON.stringify(d.s.filter(function (s) { return s[0] >= from && s[0] < to && (A.forecast || s[2] === 0); }).map(function (s) {
      return { start: iso(s[0]), price: s[1], type: s[2] ? 'forecast' : 'actual' };
    }));
  }

  switch (A.fn) {
    case 'slots': return toSlots(data);
    case 'summary': return summary(load(data), nowSeconds());
    case 'list': return list(load(data), nowSeconds());
    default: throw new Error('elpriser: unknown fn "' + A.fn + '" (slots, summary or list)');
  }
})(input);
