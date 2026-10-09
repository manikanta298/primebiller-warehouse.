import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceIssueProblems, invoiceCancelProblems, invoicesForOrg, filterInvoices,
  applyAdvancesOldestFirst, dueDateFor, invoiceStatus, invoiceNumber,
} from '../src/lib/invoice-rules.ts';

const today = '2026-10-09';
const challan = { id: 'dc1', status: 'delivered', invoiceNo: '', customerId: 'cust1', number: 'DC/0001', date: '2026-10-05', placeOfSupplyCode: '36' };
const select = (rows, ids, date = today) => invoiceIssueProblems(rows, ids, date, today);

test('delivered, uninvoiced, same customer and same place of supply can be invoiced', () => {
  assert.deepEqual(select([challan], ['dc1']), []);
  assert.deepEqual(select([challan, { ...challan, id: 'dc2', number: 'DC/0002' }], ['dc1', 'dc2']), []);
});
test('rejects missing challan ID rather than silently issuing a partial invoice', () => {
  assert.ok(select([challan], ['dc1', 'foreign-id']).some((e) => e.includes('found')));
  assert.ok(select([], ['foreign-id']).length > 0);
});
test('duplicate challan selections cannot be double billed', () => {
  assert.ok(select([challan, challan], ['dc1', 'dc1']).some((e) => e.includes('twice')));
});
test('rejects mixing places of supply and customers on one invoice', () => {
  assert.ok(select([challan, { ...challan, id: 'dc2', placeOfSupplyCode: '37' }], ['dc1', 'dc2']).some((e) => e.includes('places of supply')));
  assert.ok(select([challan, { ...challan, id: 'dc2', customerId: 'cust2' }], ['dc1', 'dc2']).some((e) => e.includes('same customer')));
});
test('rejects cancelled, in-transit and already invoiced challans', () => {
  for (const changed of [{ status: 'cancelled' }, { status: 'in_transit' }, { invoiceNo: 'INV/0001' }])
    assert.ok(select([{ ...challan, ...changed }], ['dc1']).length);
});
test('invoice date must be real, not future, and not before any challan', () => {
  for (const date of ['2026-02-30', 'yesterday', '2026-10-10', '2026-10-04'])
    assert.ok(select([challan], ['dc1'], date).length, date);
  assert.deepEqual(select([challan], ['dc1'], '2026-10-05'), []);
});
test('limits the number of challans in one issue request', () => {
  assert.ok(select([], []).length);
  assert.ok(select([], Array.from({ length: 101 }, (_, i) => `dc${i}`)).some((e) => e.includes('100')));
});
test('cancellation requires an unpaid, non-cancelled invoice from the current GST month', () => {
  const invoice = { status: 'awaiting_payment', paid: 0, date: today };
  assert.deepEqual(invoiceCancelProblems(invoice, 'Duplicate invoice created', today), []);
  for (const change of [{ status: 'cancelled' }, { paid: 10 }, { date: '2026-09-30' }, { date: '2026-11-01' }])
    assert.ok(invoiceCancelProblems({ ...invoice, ...change }, 'Duplicate invoice created', today).length);
});
test('cancellation reason enforces audit length bounds', () => {
  const invoice = { status: 'partially_paid', paid: 0, date: today };
  for (const reason of ['', 'no', ' '.repeat(20), 'a'.repeat(501)])
    assert.ok(invoiceCancelProblems(invoice, reason, today).some((e) => e.includes('reason')));
});
test('demo invoice list and details scope to the selected organisation', () => {
  const rows = [{ id: 'one' }, { id: 'two' }];
  const owners = { one: 'org1', two: 'org2' };
  assert.deepEqual(invoicesForOrg(rows, owners, 'org1'), [{ id: 'one' }]);
  assert.deepEqual(invoicesForOrg(rows, owners, 'org2'), [{ id: 'two' }]);
  assert.deepEqual(invoicesForOrg(rows, owners, ''), []);
});
test('search matches invoice/customer/challan/due date and respects status', () => {
  const base = { date: '2026-10-07', customerName: 'Alpha Traders', status: 'awaiting_payment', dueDate: '2026-11-06', challans: [{ number: 'DC/008' }] };
  const rows = [{ ...base, number: 'INV/100' }, { ...base, number: 'INV/101', customerName: 'Beta Traders', status: 'paid', date: '2026-10-08' }];
  assert.deepEqual(filterInvoices(rows, 'all', 'alpha dc/008').map((r) => r.number), ['INV/100']);
  assert.deepEqual(filterInvoices(rows, 'paid', '').map((r) => r.number), ['INV/101']);
  assert.deepEqual(filterInvoices(rows, 'all', '').map((r) => r.number), ['INV/101', 'INV/100']);
});
test('advances apply oldest first without exceeding invoice total', () => {
  const available = [{ id: 'new', date: '2026-10-09', remaining: 60 }, { id: 'old', date: '2026-09-01', remaining: 50 }];
  assert.deepEqual(applyAdvancesOldestFirst(available, 70), [{ advanceId: 'old', amount: 50 }, { advanceId: 'new', amount: 20 }]);
});
test('due date, status and numbering remain deterministic', () => {
  assert.equal(dueDateFor('2026-10-09', 30), '2026-11-08');
  assert.equal(invoiceStatus(100, 0, '2026-10-08', today), 'overdue');
  assert.equal(invoiceStatus(100, 40, '2026-10-10', today), 'partially_paid');
  assert.equal(invoiceStatus(100, 100, '2026-10-10', today), 'paid');
  assert.equal(invoiceNumber('INV', '26-27', 44), 'INV/26-27/0044');
});
