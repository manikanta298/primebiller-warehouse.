import test from 'node:test';
import assert from 'node:assert/strict';
import { quotationProblems, quotationActionProblem, quotationPaymentProblem, invoiceAdvances, invoiceAdvanceAllocations } from '../src/lib/quotation-rules.ts';
const draft = { date: '2026-10-11', validUntil: '2026-10-18', customerId: 'c', godownId: 'g', notes: '', terms: '', lines: [{ itemId: 'i', qty: 1, rate: 100, discountPct: 0, uom: 'PCS' }] };
test('quotation dates and lines validate without a stock availability requirement', () => {
  assert.deepEqual(quotationProblems(draft, '2026-10-11'), []);
  for (const validUntil of ['2026-02-30', '2026-10-10', 'not-a-date']) assert.ok(quotationProblems({ ...draft, validUntil }, '2026-10-11').length);
  assert.ok(quotationProblems({ ...draft, date: '2026-10-12' }, '2026-10-11').length);
  assert.ok(quotationProblems({ ...draft, lines: [{ ...draft.lines[0], qty: -1 }] }, '2026-10-11').length);
});
test('acceptance and conversion require the expected status and unexpired validity', () => {
  assert.equal(quotationActionProblem({ status: 'accepted', validUntil: '2026-10-11' }, 'convert', '2026-10-11'), undefined);
  for (const status of ['draft', 'issued', 'cancelled']) assert.ok(quotationActionProblem({ status, validUntil: '2026-10-18' }, 'convert', '2026-10-11'));
  assert.ok(quotationActionProblem({ status: 'accepted', validUntil: '2026-10-10' }, 'convert', '2026-10-11'));
});
test('linked advances automatically apply only to their own order and general advances remain optional', () => {
  const a = { id: 'general' }, b = { id: 'quote-pending', quotationId: 'q' }, c = { id: 'mine', quotationId: 'q', salesOrderId: 'so1' }, d = { id: 'other', quotationId: 'q2', salesOrderId: 'so2' };
  assert.deepEqual(invoiceAdvances([a,b,c,d], ['so1'], false), [c]);
  assert.deepEqual(invoiceAdvances([a,b,c,d], ['so1'], true), [a,c]);
});
test('quotation payments match customer, are all advances, and cannot exceed the total in paise', () => {
  const q = { status: 'accepted', customerId: 'c', date: '2026-10-11', validUntil: '2026-10-18', grandTotal: 0.3, payments: [{ amount: 0.1 }] };
  const p = { customerId: 'c', date: '2026-10-11', amount: 0.2, requestKey: '1234567890123456', allocations: [] };
  assert.equal(quotationPaymentProblem(q,p), undefined);
  for (const change of [{ customerId: 'other' }, { date: '2026-10-10' }, { amount: 0.21 }, { requestKey: '' }, { allocations: [{}] }]) assert.ok(quotationPaymentProblem(q,{ ...p, ...change }));
  assert.ok(quotationPaymentProblem({ ...q, status: 'converted' },p));
});

test('earmarked quote advances take priority over older general customer advances', () => {
  const linked = { id: 'q-adv', date: '2026-10-11', remaining: 40, quotationId: 'q', salesOrderId: 'so1' };
  const general = { id: 'general', date: '2026-01-01', remaining: 200 };
  assert.deepEqual(invoiceAdvanceAllocations([general, linked], ['so1'], true, 100), [{advanceId:'q-adv',amount:40},{advanceId:'general',amount:60}]);
  assert.deepEqual(invoiceAdvanceAllocations([general, linked], ['so1'], false, 20), [{advanceId:'q-adv',amount:20}]);
});
