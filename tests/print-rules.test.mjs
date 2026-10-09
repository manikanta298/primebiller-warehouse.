import test from 'node:test';
import assert from 'node:assert/strict';
import { PRINT_DEFAULTS, printProfileProblems, normalisePrintProfile, printCopyLabels, taxBreakdown } from '../src/lib/print-rules.ts';

const copy = (id, changes = {}) => ({ ...PRINT_DEFAULTS[id], ...changes });

test('both fixed profile templates validate', () => {
  assert.deepEqual(printProfileProblems(copy('A'), 'A'), []);
  assert.deepEqual(printProfileProblems(copy('B'), 'B'), []);
});
test('profile path mismatch cannot overwrite another template', () => {
  assert.match(printProfileProblems(copy('A'), 'B').join(' '), /ID/);
});
test('paper and template names are immutable', () => {
  assert.match(printProfileProblems(copy('B', { paper: '80mm' })).join(' '), /template/);
  assert.match(printProfileProblems(copy('A', { name: 'Fake document' })).join(' '), /template/);
});
test('copies must be a whole number from 1 through 5', () => {
  for (const n of [-1, 0, 1.5, 6, Number.POSITIVE_INFINITY, NaN])
    assert.match(printProfileProblems(copy('A', { copies: n })).join(' '), /Copies/);
  for (const n of [1, 5]) assert.deepEqual(printProfileProblems(copy('A', { copies: n })), []);
});
test('booleans validated server-side', () => {
  assert.match(printProfileProblems(copy('A', { showLogo: 'yes' })).join(' '), /showLogo/);
});
test('footer is bounded and control characters are rejected', () => {
  assert.match(printProfileProblems(copy('A', { footer: 'x'.repeat(161) })).join(' '), /Footer/);
  assert.match(printProfileProblems(copy('A', { footer: 'hello\x00world' })).join(' '), /Footer/);
  assert.deepEqual(printProfileProblems(copy('A', { footer: ' Welcome! ' })), []);
});
test('footer trimming preserves other choices', () => {
  const p = copy('B', { footer: '  Thanks  ', copies: 2 });
  const actual = normalisePrintProfile(p);
  assert.equal(actual.footer, 'Thanks');
  assert.equal(actual.copies, 2);
  assert.equal(p.footer, '  Thanks  ');
});
test('separate copy labels do not multiply money amounts', () => {
  assert.deepEqual(printCopyLabels(1), ['Original']);
  assert.deepEqual(printCopyLabels(3), ['Original', 'Copy 2', 'Copy 3']);
  assert.deepEqual(printCopyLabels(0), []);
  assert.deepEqual(printCopyLabels(6), []);
});
test('HSN summary aggregates repeated HSN/rate and applies discounts', () => {
  const rows = taxBreakdown([
    { hsn: '7214', gstRate: 18, qty: 2, rate: 100, discountPct: 10 },
    { hsn: '7214', gstRate: 18, qty: 1, rate: 20, discountPct: 0 },
    { hsn: '7214', gstRate: 5, qty: 1, rate: 100, discountPct: 0 },
  ]);
  assert.deepEqual(rows, [{ hsn: '7214', rate: 18, taxable: 200, tax: 36 }, { hsn: '7214', rate: 5, taxable: 100, tax: 5 }]);
});
test('an empty set of invoice lines has no HSN rows', () => {
  assert.deepEqual(taxBreakdown([]), []);
});
