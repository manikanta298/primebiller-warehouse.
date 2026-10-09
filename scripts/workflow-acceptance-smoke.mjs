/**
 * Stage 23: read-only reconciliation of a known, already-posted test workflow.
 * GET-only, no response bodies/JWTs in stdout. No changes to business data.
 * An operator must create the test documents separately in an isolated test org.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ids = ['poId', 'grnId', 'soId', 'challanId', 'invoiceId', 'receiptId'];
const endpoints = [
  ['po', 'purchase-orders', 'poId'], ['grn', 'grns', 'grnId'],
  ['so', 'sales-orders', 'soId'], ['challan', 'challans', 'challanId'],
  ['invoice', 'invoices', 'invoiceId'], ['receipt', 'receipts', 'receiptId'],
];
const round = n => Math.round(n * 100) / 100;
const quantity = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const sum = (xs, prop) => xs.reduce((total, item) => total + item[prop], 0);
const list = value => Array.isArray(value) ? value : [];
const equalMoney = (a, b) => quantity(a) && quantity(b) && Math.abs(round(a - b)) <= 0.01;
const containsId = (items, id) => list(items).some(v => v && v.id === id);

function validateOrigin(base) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a gateway origin only, without credentials, path, query or fragment');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Remote gateway must use HTTPS');
  return url;
}

function validateInputs({ token, orgId, documents }) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('A dedicated test JWT is required');
  if (typeof orgId !== 'string' || !/^[\w-]{1,128}$/.test(orgId)) throw new Error('A valid test organisation ID is required');
  for (const name of ids) {
    if (!/^[\w-]{1,128}$/.test(documents?.[name] ?? '')) throw new Error(`${name} must be an explicit test-document ID`);
  }
}

/** No write requests. Checks selected linked documents, not all company transactions. */
export async function runWorkflowAcceptance(base, { token, orgId, documents, fetcher = fetch } = {}) {
  const origin = validateOrigin(base);
  validateInputs({ token, orgId, documents });
  const fetched = {};
  const outcomes = [];
  for (const [alias, resource, key] of endpoints) {
    let ok = false;
    let reason = 'Network or malformed response';
    try {
      const response = await fetcher(new URL(`/api/v1/${resource}/${encodeURIComponent(documents[key])}`, origin), {
        method: 'GET', redirect: 'manual',
        headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': orgId, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (response.status !== 200) reason = `Expected HTTP 200, got ${response.status}`;
      else {
        const body = await response.json();
        if (body && typeof body === 'object' && !Array.isArray(body) && body.id === documents[key]) {
          fetched[alias] = body;
          ok = true;
          reason = 'HTTP 200, expected document ID';
        } else reason = 'Unexpected document shape or ID';
      }
    } catch { /* never leak tokens, IDs, response bodies or network errors */ }
    outcomes.push({ label: `Read ${alias}`, ok, reason });
  }
  if (Object.keys(fetched).length !== endpoints.length) return outcomes;
  return outcomes.concat(validateWorkflowDocuments(fetched));
}

/** Pure acceptance invariants; accepts plain objects to permit offline fixture tests. */
export function validateWorkflowDocuments({ po, grn, so, challan, invoice, receipt }) {
  const results = [];
  function check(label, predicate) {
    let ok = false;
    try { ok = predicate() === true; } catch { /* fail closed on malformed fields */ }
    results.push({ label, ok, reason: ok ? 'Consistent' : 'Reconciliation failed' });
  }
  check('PO to GRN linkage', () => po.id === grn.poId && po.supplierId === grn.supplierId && po.godownId === grn.godownId && containsId(po.grns, grn.id));
  check('GRN quantities and PO limits', () => {
    if (!Array.isArray(grn.lines) || !grn.lines.length || !Array.isArray(po.lines)) return false;
    const byPoLine = new Map();
    for (const line of grn.lines) {
      if (![line.received, line.accepted, line.rejected].every(quantity) ||
        Math.abs((line.accepted + line.rejected) - line.received) > 0.00001 || !line.poLineId) return false;
      const poLine = po.lines.find(v => v.id === line.poLineId);
      if (!poLine || poLine.itemId !== line.itemId) return false;
      byPoLine.set(line.poLineId, (byPoLine.get(line.poLineId) ?? 0) + line.received);
    }
    return [...byPoLine].every(([id, qty]) => {
      const line = po.lines.find(v => v.id === id);
      return quantity(line.qty) && quantity(line.receivedQty) && qty <= line.qty + 0.00001 && qty <= line.receivedQty + 0.00001;
    });
  });
  check('Sales order to challan linkage', () => so.id === challan.soId && so.customerId === challan.customerId && so.godownId === challan.godownId);
  check('Dispatched line quantities', () => {
    if (!Array.isArray(challan.lines) || !challan.lines.length || !Array.isArray(so.lines)) return false;
    const byLine = new Map();
    for (const line of challan.lines) {
      if (!quantity(line.qty) || line.qty <= 0) return false;
      const soLine = so.lines.find(v => v.id === line.soLineId);
      if (!soLine || soLine.itemId !== line.itemId) return false;
      byLine.set(line.soLineId, (byLine.get(line.soLineId) ?? 0) + line.qty);
    }
    return [...byLine].every(([id, qty]) => {
      const soLine = so.lines.find(v => v.id === id);
      return quantity(soLine.qty) && quantity(soLine.deliveredQty) && qty <= soLine.qty + 0.00001 && qty <= soLine.deliveredQty + 0.00001;
    });
  });
  check('Challan to invoice linkage', () => invoice.customerId === challan.customerId && containsId(invoice.challans, challan.id) && challan.invoiceNo === invoice.number && invoice.status !== 'cancelled');
  check('Invoice to receipt allocation', () => {
    const allocations = list(receipt.allocations);
    const relevant = allocations.filter(v => v.invoiceId === invoice.id);
    return relevant.length > 0 && receipt.customerId === invoice.customerId && relevant.every(v => v.invoiceNo === invoice.number && quantity(v.amount) && v.amount > 0) &&
      quantity(receipt.amount) && quantity(receipt.advance) &&
      equalMoney(sum(allocations, 'amount') + receipt.advance, receipt.amount) &&
      relevant.reduce((acc, v) => acc + v.amount, 0) <= invoice.paid + 0.01;
  });
  check('Invoice totals and paid balance', () => {
    const advances = list(invoice.advances);
    const totalAdvances = advances.reduce((v, a) => v + a.amount, 0);
    if (![invoice.grandTotal, invoice.paid, invoice.balance, totalAdvances].every(quantity)) return false;
    return equalMoney(invoice.grandTotal, round(invoice.paid + totalAdvances + invoice.balance));
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = await runWorkflowAcceptance(process.argv[2] ?? 'http://localhost:8080', {
      token: process.env.ACCEPTANCE_TOKEN, orgId: process.env.ACCEPTANCE_ORG_ID,
      documents: Object.fromEntries(ids.map(id => [id, process.env[`ACCEPTANCE_${id.replace(/[A-Z]/g, c => '_' + c).toUpperCase()}`]])),
    });
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label}: ${r.reason}`);
    if (results.some(r => !r.ok)) process.exitCode = 1;
    else console.log('Selected linked test documents reconcile. This is read-only; posting, concurrent rollback and full account balances remain unverified.');
  } catch (e) {
    console.error(`Workflow acceptance cannot run: ${e.message}`);
    process.exitCode = 2;
  }
}
