#!/usr/bin/env node
// Writes the summary answers of conf/transform/elpriser.js for the recorded fixtures at a fixed moment, so the
// JSONPATH checks (test/jsonpath) can run against what the script really produces.
//   node scripts/gen-fixtures.mjs          write
//   node scripts/gen-fixtures.mjs --check  fail if they are out of date
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, transform, root } from '../test/helpers.js';

const AT = '2026-11-03T10:15:00Z';
const make = (name, at) => transform(transform(fixture(name), { fn: 'slots' }), { fn: 'summary', at }) + '\n';
const files = {
  'summary-dk1.json': make('dk1_fc', AT),
  'summary-gb-late.json': make('gb', '2026-11-03T22:10:00Z'),
  'summary-de.json': make('de', AT)
};
let bad = 0;
for (const [name, content] of Object.entries(files)) {
  const path = join(root, 'test/fixtures', name);
  if (process.argv.includes('--check')) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) { console.error('out of date: ' + name); bad++; }
  } else {
    writeFileSync(path, content);
    console.log('wrote ' + name);
  }
}
process.exit(bad ? 1 : 0);
