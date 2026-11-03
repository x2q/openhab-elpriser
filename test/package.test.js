import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './helpers.js';

const read = (p) => readFileSync(join(root, p), 'utf8');
const cases = JSON.parse(read('test/jsonpath/cases.json'));
const caseExprs = new Set(cases.map((c) => c.expr));

const things1 = read('conf/things/elpriser-dk-jsonpath.things');
const things2 = read('conf/things/elpriser.things');
const items1 = read('conf/items/elpriser-dk-jsonpath.items');
const items2 = read('conf/items/elpriser.items');
const rules = read('conf/rules/elpriser.rules');

const stripComments = (s) => s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('every JSONPATH expression in the Denmark things file is covered by the Jayway checks', () => {
  const exprs = [...stripComments(things1).matchAll(/stateTransformation="JSONPATH\((.+?)\)"/g)].map((m) => m[1]);
  assert.ok(exprs.length >= 10, 'found the channels');
  for (const e of exprs) assert.ok(caseExprs.has(e), `not covered by test/jsonpath/cases.json: ${e}`);
});

test('every field the rule extracts exists in the JS summary and is covered by the Jayway checks', () => {
  const fields = [...rules.matchAll(/transform\("JSONPATH", "(\$\.[a-z_]+)", s\)/g)].map((m) => m[1]);
  assert.ok(fields.length >= 18);
  const summary = JSON.parse(read('test/fixtures/summary-dk1.json'));
  for (const f of fields) {
    assert.ok(f.slice(2) in summary, `${f} is not in the summary`);
    assert.ok(caseExprs.has(f), `not covered by test/jsonpath/cases.json: ${f}`);
  }
});

test('every item the rule writes is declared, and every Elpriser_ item of the sitemaps exists', () => {
  const declared = (items) => new Set([...items.matchAll(/^(?:String|Number|Switch|DateTime|Group)\s+(\w+)/gm)].map((m) => m[1]));
  const d2 = declared(items2);
  for (const m of rules.matchAll(/^\s*(Elpriser_\w+)\.postUpdate/gm)) assert.ok(d2.has(m[1]), m[1]);
  for (const [sm, items] of [['elpriser.sitemap', d2], ['elpriser-dk.sitemap', declared(items1)]]) {
    const text = read('conf/sitemaps/' + sm);
    for (const m of text.matchAll(/item=(Elpriser_\w+)/g)) assert.ok(items.has(m[1]), `${sm}: ${m[1]}`);
  }
});

test('every channel an item links to exists in the things files', () => {
  const channels = (things, thingRe) => {
    const out = new Set();
    for (const t of things.matchAll(/Thing http:url:(\w+) [\s\S]*?\n\}/g)) {
      for (const c of t[0].matchAll(/Type \w+ : (\w+)/g)) out.add(`http:url:${t[1]}:${c[1]}`);
    }
    return out;
  };
  const c1 = channels(things1);
  const c2 = channels(things2);
  assert.equal(c1.size, 11);
  assert.equal(c2.size, 1);
  for (const m of items1.matchAll(/channel="([^"]+)"/g)) assert.ok(c1.has(m[1]), m[1]);
  for (const m of items2.matchAll(/channel="([^"]+)"/g)) assert.ok(c2.has(m[1]), m[1]);
  // and the other way round: every channel is linked
  for (const c of c1) assert.ok(items1.includes(`channel="${c}"`), `unlinked: ${c}`);
});

test('all channels are read-only (no command can reach the service) and use a User-Agent', () => {
  for (const things of [things1, things2]) {
    const text = stripComments(things);
    for (const line of text.split('\n').filter((l) => /^\s+Type /.test(l))) assert.match(line, /mode="READONLY"/, line);
    for (const t of text.matchAll(/Thing http:url:[\s\S]*?\n\] \{/g)) assert.match(t[0], /headers="User-Agent=openhab-elpriser\//);
  }
});

test('the URLs in the things files are calls the service documents', () => {
  const urls = [...stripComments(things1 + things2).matchAll(/baseURL="([^"]+)"/g)].map((m) => new URL(m[1]));
  assert.ok(urls.length >= 5);
  for (const u of urls) {
    assert.equal(u.origin, 'https://elpriser.org');
    assert.ok(['/api/prices', '/api/schedule', '/api/forecast', '/api/nordic'].includes(u.pathname), u.pathname);
  }
});

test('the summary fixtures are what the script produces', () => {
  execFileSync('node', ['scripts/gen-fixtures.mjs', '--check'], { cwd: root });
});

test('files are present: README, LICENSE, workflow', () => {
  for (const f of ['README.md', 'LICENSE', '.github/workflows/tests.yml']) assert.ok(existsSync(join(root, f)), f);
  assert.ok(readdirSync(join(root, 'conf')).length >= 5);
});
