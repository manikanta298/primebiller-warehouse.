import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptPaise, receiptProblems, receiptAllocation, receiptsForOrg, filterReceipts } from '../src/lib/receipt-rules.ts';

const today = '2026-10-09';
const open = [
  { id: 'new', number: 'INV/002', date: '2026-10-08', balance: 0.2 },
  { id: 'old', number: 'INV/001', date: '2026-10-01', balance: 0.1 },
];
const draft = { customerId: 'p1', date: today, amount: 0.3, mode: 'neft', reference: 'UTR123', allocations: [{ invoiceId: 'old', amount: 0.1 }, { invoiceId: 'new', amount: 0.2 }] };
const p = (patch = {}, inv = open) => receiptProblems({ ...draft, ...patch }, inv, today);

test('valid two-decimal allocation is accepted', () => assert.deepEqual(p(), []));
test('invalid dates, impossible dates and future receipts are blocked', () => {
  for (const date of ['2026-02-30', 'bad', '2026-10-10']) assert.ok(p({ date }).length, date);
});
test('cannot record dated before an allocated invoice', () => assert.ok(p({ date: '2026-10-04' }).some((x) => x.includes('precede'))));
test('cash accepts empty reference, noncash requires one', () => {
  assert.deepEqual(p({ mode: 'cash', reference: '' }), []);
  assert.ok(p({ mode: 'upi', reference: '' }).some((x) => x.includes('reference')));
});
test('amount must be positive finite and at most two decimal places', () => {
  for (const amount of [0, -1, Number.POSITIVE_INFINITY, Number.NaN, 1.001]) assert.ok(p({ amount }).length, String(amount));
  assert.equal(receiptPaise(19.99), 1999);
  assert.equal(receiptPaise(0.001), null);
});
test('rejects duplicate invoice allocations even when each line fits', () => {
  assert.ok(p({ amount: 0.2, allocations: [{ invoiceId: 'old', amount: 0.1 }, { invoiceId: 'old', amount: 0.1 }] }).some((x) => x.includes('twice')));
});
test('cannot allocate to missing, closed or another-customer invoices', () => {
  assert.ok(p({ allocations: [{ invoiceId: 'foreign', amount: 0.1 }] }).some((x) => x.includes('not open')));
});
test('rejects individually excessive or negative allocations', () => {
  assert.ok(p({ allocations: [{ invoiceId: 'old', amount: 0.2 }] }).some((x) => x.includes('balance')));
  assert.ok(p({ allocations: [{ invoiceId: 'old', amount: -0.01 }] }).some((x) => x.includes('non-negative')));
});
test('rejects total split that exceeds received money', () => {
  assert.ok(p({ amount: 0.2 }).some((x) => x.includes('Allocated more')));
});
test('allows empty manual allocation as an advance', () => {
  assert.deepEqual(p({ allocations: [] }), []);
  assert.deepEqual(p({ allocations: undefined }), []);
});
test('exact paise oldest-first: no phantom remaining advance', () => {
  assert.deepEqual(receiptAllocation(open, 0.3), { allocations: [{ invoiceId: 'old', amount: 0.1 }, { invoiceId: 'new', amount: 0.2 }], advance: 0 });
  assert.deepEqual(receiptAllocation(open, 0.5).advance, 0.2);
});
test('ownership filters receipt and advance lists', () => {
  const rows = [{ id: 'one' }, { id: 'two' }, { id: 'missing' }];
  const owners = { one: 'org1', two: 'org2' };
  assert.deepEqual(receiptsForOrg(rows, owners, 'org1'), [{ id: 'one' }]);
  assert.deepEqual(receiptsForOrg(rows, owners, ''), []);
});
test('search receipt, reference, customer and linked invoices', () => {
  const receipts = [
    { number: 'RCT/002', date: today, customerName: 'Delta', mode: 'cash', reference: '', allocations: [] },
    { number: 'RCT/001', date: '2026-10-08', customerName: 'Rajesh Constructions', mode: 'neft', reference: 'UTR-338', allocations: [{ invoiceNo: 'INV/001' }] },
  ];
  assert.deepEqual(filterReceipts(receipts, 'rajesh inv/001').map((r) => r.number), ['RCT/001']);
  assert.deepEqual(filterReceipts(receipts, 'UTR-338').map((r) => r.number), ['RCT/001']);
  assert.deepEqual(filterReceipts(receipts, '').map((r) => r.number), ['RCT/002', 'RCT/001']);
});
