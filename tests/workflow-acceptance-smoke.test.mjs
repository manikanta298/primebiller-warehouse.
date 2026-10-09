import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runWorkflowAcceptance, validateWorkflowDocuments } from '../scripts/workflow-acceptance-smoke.mjs';

const accounts = {
  po: { id: 'p1', supplierId: 'supplier', godownId: 'g1', lines: [{ id: 'pl1', itemId: 'item1', qty: 10, receivedQty: 5 }], grns: [{ id: 'gr1' }] },
  grn: { id: 'gr1', poId: 'p1', supplierId: 'supplier', godownId: 'g1', lines: [{ poLineId: 'pl1', itemId: 'item1', received: 5, accepted: 4, rejected: 1 }] },
  so: { id: 's1', customerId: 'customer', godownId: 'g1', lines: [{ id: 'sl1', itemId: 'item1', qty: 8, deliveredQty: 4 }] },
  challan: { id: 'ch1', soId: 's1', customerId: 'customer', godownId: 'g1', lines: [{ soLineId: 'sl1', itemId: 'item1', qty: 4 }], invoiceNo: 'INV-1' },
  invoice: { id: 'in1', number: 'INV-1', customerId: 'customer', challans: [{ id: 'ch1' }], status: 'partially_paid', grandTotal: 1000, paid: 300, balance: 600, advances: [{ amount: 100 }] },
  receipt: { id: 'r1', customerId: 'customer', amount: 300, advance: 0, allocations: [{ invoiceId: 'in1', invoiceNo: 'INV-1', amount: 300 }] },
};
const clone = () => structuredClone(accounts);
const config = { token: 'test-jwt', orgId: 'org1', documents: { poId: 'p1', grnId: 'gr1', soId: 's1', challanId: 'ch1', invoiceId: 'in1', receiptId: 'r1' } };
const endpointToDoc = Object.fromEntries([
  ['purchase-orders/p1', 'po'], ['grns/gr1', 'grn'], ['sales-orders/s1', 'so'], ['challans/ch1', 'challan'], ['invoices/in1', 'invoice'], ['receipts/r1', 'receipt'],
]);

test('valid linked PO->GRN and SO->challan->invoice->receipt fixture reconciles', () => {
  const r = validateWorkflowDocuments(clone());
  assert.equal(r.length, 7);
  assert.ok(r.every(x => x.ok), JSON.stringify(r));
});

test('rejects PO/GRN supplier mismatch and over-receiving even when other fields match', () => {
  const docs = clone(); docs.grn.supplierId = 'wrong';
  assert.equal(validateWorkflowDocuments(docs)[0].ok, false);
  docs.grn.supplierId = 'supplier'; docs.grn.lines[0].received = 11; docs.grn.lines[0].accepted = 10; docs.grn.lines[0].rejected = 1;
  assert.equal(validateWorkflowDocuments(docs)[1].ok, false);
});

test('rejects repeated GRN lines that collectively exceed the PO quantity', () => {
  const docs = clone(); docs.grn.lines.push({ ...docs.grn.lines[0], received: 6, accepted: 6, rejected: 0 });
  assert.equal(validateWorkflowDocuments(docs)[1].ok, false);
});

test('rejects repeated challan lines exceeding sales-order delivered amount', () => {
  const docs = clone(); docs.challan.lines.push({ ...docs.challan.lines[0] });
  assert.equal(validateWorkflowDocuments(docs)[3].ok, false);
});

test('rejects missing invoice/challan linkage and inconsistent receipt', () => {
  const docs = clone(); docs.challan.invoiceNo = 'OTHER';
  assert.equal(validateWorkflowDocuments(docs)[4].ok, false);
  docs.challan.invoiceNo = 'INV-1'; docs.receipt.advance = 100;
  assert.equal(validateWorkflowDocuments(docs)[5].ok, false);
});

test('rejects invoice balance discrepancies and cancellation', () => {
  const docs = clone(); docs.invoice.balance = 900;
  assert.equal(validateWorkflowDocuments(docs)[6].ok, false);
  docs.invoice.balance = 600; docs.invoice.status = 'cancelled';
  assert.equal(validateWorkflowDocuments(docs)[4].ok, false);
});

test('read-only probe uses exactly six authenticated GETs with scoped headers and returns 13 successes', async () => {
  const calls = [];
  const result = await runWorkflowAcceptance('https://test.example', {
    ...config,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, json: async () => clone()[endpointToDoc[url.pathname.replace('/api/v1/', '')]] };
    },
  });
  assert.equal(result.length, 13);
  assert.ok(result.every(x => x.ok));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'manual' && c.options.headers['X-Org-Id'] === 'org1' && c.options.headers.Authorization === 'Bearer test-jwt'));
});

test('wrong ID/failed requests fail closed before document reconciliation', async () => {
  const result = await runWorkflowAcceptance('https://test.example', {
    ...config,
    fetcher: async (url) => url.pathname.includes('/grns/') ? { status: 403 } : { status: 200, json: async () => ({ id: 'not-the-id' }) },
  });
  assert.equal(result.length, 6);
  assert.ok(result.every(x => !x.ok));
});

test('network errors and JSON failures do not expose tokens', async () => {
  const result = await runWorkflowAcceptance('https://test.example', { ...config, fetcher: async () => { throw Error('secret test-jwt'); } });
  assert.equal(result.length, 6);
  assert.ok(result.every(x => !x.ok));
  assert.ok(!JSON.stringify(result).includes('test-jwt'));
});

test('rejects malformed org/IDs, remote HTTP and credential-bearing URL', async () => {
  await assert.rejects(runWorkflowAcceptance('http://some-domain.example', config), /HTTPS/);
  await assert.rejects(runWorkflowAcceptance('https://username:pwd@test.example', config), /gateway origin/);
  await assert.rejects(runWorkflowAcceptance('https://test.example/path', config), /gateway origin/);
  await assert.rejects(runWorkflowAcceptance('https://test.example', { ...config, orgId: 'org\n2' }), /organisation/);
  await assert.rejects(runWorkflowAcceptance('https://test.example', { ...config, documents: { ...config.documents, poId: '../traversal' } }), /poId/);
  await assert.rejects(runWorkflowAcceptance('https://test.example', { ...config, token: '' }), /JWT/);
});
