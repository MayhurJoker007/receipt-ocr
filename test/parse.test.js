import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { amountsIn, findDate, parseReceipt } from '../src/parse.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('grocery slip: total, VAT and items agree', () => {
  const r = parseReceipt(fixture('grocery.txt'));
  assert.equal(r.merchant, 'KASI FRESH SUPERMARKET');
  assert.equal(r.date, '2026-09-27');
  assert.equal(r.total, 187.46);
  assert.equal(r.vat, 24.45);
  assert.equal(r.items.length, 5);
  assert.deepEqual(r.items[1], { description: 'WHITE BREAD 700G', qty: 2, amount: 35.98 });
  assert.equal(r.confidence, 1);
  assert.deepEqual(r.notes, []);
});

test('noisy fuel slip: OCR digit mistakes are corrected', () => {
  const r = parseReceipt(fixture('fuel-noisy.txt'));
  assert.equal(r.total, 650.0);
  assert.equal(r.date, '2026-10-02');
  assert.ok(r.notes.every(n => !n.includes('VAT')), r.notes.join());
});

test('restaurant bill: ignores the cash tendered and change lines', () => {
  const r = parseReceipt(fixture('restaurant.txt'));
  assert.equal(r.total, 412.5);
  assert.ok(!r.items.some(i => i.amount === 500));
  assert.ok(!r.items.some(i => i.amount === 87.5));
});

test('no total label: falls back to the largest amount and says so', () => {
  const r = parseReceipt('SPAZA\n2x Coke 2L 59.98\nBread 18.99\n78.97\n');
  assert.equal(r.total, 78.97);
  assert.match(r.notes[0], /guessed/);
});

test('amounts in different formats', () => {
  assert.deepEqual(amountsIn('R1 234,50'), [1234.5]);
  assert.deepEqual(amountsIn('TOTAL  R 87.5O'), [87.5]);
  assert.deepEqual(amountsIn('2 @ 17.99   35.98'), [17.99, 35.98]);
  assert.deepEqual(amountsIn('VAT REG 4123456789'), []);
});

test('dates in South African formats', () => {
  assert.equal(findDate('Date: 05/10/2026 14:32'), '2026-10-05');
  assert.equal(findDate('2026-10-05T14:32'), '2026-10-05');
  assert.equal(findDate('05.10.26'), '2026-10-05');
  assert.equal(findDate('5 Oct 2026'), '2026-10-05');
  assert.equal(findDate('13/13/2026'), null);
});
