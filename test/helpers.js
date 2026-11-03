import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fixture = (n) => JSON.parse(readFileSync(join(root, 'test/fixtures', n + '.json'), 'utf8'));
export const zones = fixture('zones');
const script = readFileSync(join(root, 'conf/transform/elpriser.js'), 'utf8');

/** Run conf/transform/elpriser.js the way openHAB's JS transformation does: `input` and the URL arguments are variables. */
export function transform(input, args = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return vm.runInNewContext(script, { input: text, ...args });
}

const fmts = new Map();
/** Local date and hour of a unix-seconds instant in an IANA zone (Intl as the independent reference). */
export function localParts(sec, tz) {
  if (!fmts.has(tz)) {
    fmts.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }));
  }
  const p = Object.fromEntries(fmts.get(tz).formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
