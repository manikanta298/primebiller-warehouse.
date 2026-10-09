import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validReportMonth, validReportDate, validReportRange, inPeriod, b2clThresholdForPeriod,
  salesRegister, receivables, itemSales, buildGstr1, gstr1Json, gstr1Csv, toCsv,
} from '../src/lib/reports.ts';

const invoice = (id, extras = {}) => {
  const supply = extras.supply ?? 'intra';
  const tax = 18;
  return {
    id, number: `INV/${id}`, date: '2026-10-05', dueDate: '2026-10-15',
    customerId: `c${id}`, customerName: `Customer ${id}`, gstin: '36ABCDE1234F1Z5',
    placeOfSupplyCode: supply === 'inter' ? '37' : '36', placeOfSupplyName: supply === 'inter' ? 'Andhra Pradesh' : 'Telangana', supply,
    status: 'awaiting_payment', taxable: 100, cgst: supply === 'intra' ? 9 : 0,
    sgst: supply === 'intra' ? 9 : 0, igst: supply === 'inter' ? 18 : 0,
    grandTotal: 118, balance: 118, paid: 0,
    byRate: [{ rate: 18, taxable: 100, tax }],
    lines: [{ itemId: 'i1', itemName: 'Steel', hsn: '7216', uom: 'KG', qty: 2, rate: 50, discountPct: 0, gstRate: 18 }],
    ...extras,
  };
};
const build = (a) => buildGstr1(a, '2026-10', '36ABCDEF1234G1Z5');

test('reports accept genuine months but reject month 00/13 and malformed years', () => {
  for (const p of ['2026-01', '2026-12', '2000-01', '2100-12']) assert.ok(validReportMonth(p));
  for (const p of ['2026-00', '2026-13', '2026-1', '1999-12', '2101-01', 'a2026-02']) assert.ok(!validReportMonth(p), p);
});
test('range validates actual calendar days and rejects reversal', () => {
  assert.ok(validReportDate('2024-02-29'));
  for (const p of ['2025-02-29', '2026-04-31', '2026-01-00', 'not-a-date']) assert.ok(!validReportDate(p), p);
  assert.ok(validReportRange('2026-10-01', '2026-10-31'));
  assert.ok(!validReportRange('2026-10-10', '2026-10-09'));
});
test('period selection uses exact year-month boundaries', () => {
  assert.ok(inPeriod('2026-10-09', '2026-10'));
  assert.ok(!inPeriod('2026-11-01', '2026-10'));
  assert.ok(!inPeriod('2026-10-01', '2026-13'));
});
test('B2CL cutoff has August 2024 transition', () => {
  assert.equal(b2clThresholdForPeriod('2024-07'), 250000);
  assert.equal(b2clThresholdForPeriod('2024-08'), 100000);
  assert.equal(b2clThresholdForPeriod('2026-10'), 100000);
});
test('GSTR-1 excludes cancelled invoices but document series counts them', () => {
  const g = build([invoice('1'), invoice('2', { status: 'cancelled' })]);
  assert.equal(g.totals.invoices, 1);
  assert.equal(g.docs[0].total, 2);
  assert.equal(g.docs[0].cancelled, 1);
  assert.equal(g.totals.taxable, 100);
});
test('GSTR-1 B2B includes GSTIN; B2C splits into large inter and small aggregate', () => {
  const large = invoice('L', { gstin: '', supply: 'inter', grandTotal: 120000 });
  const small = invoice('S', { gstin: '', supply: 'inter', grandTotal: 100000 });
  const g = build([invoice('B'), large, small]);
  assert.equal(g.b2b.length, 1);
  assert.equal(g.b2cl.length, 1);
  assert.equal(g.b2cl[0].invoiceNo, 'INV/L');
  assert.equal(g.b2cs.length, 1);
});
test('GSTR-1 exactly 1 lakh is not B2CL', () => {
  assert.equal(build([invoice('E', { gstin: '', supply: 'inter', grandTotal: 100000 })]).b2cl.length, 0);
});
test('GST HSN rows separate B2B and B2C even with identical HSN, unit, rate', () => {
  const g = build([invoice('B'), invoice('C', { gstin: '' })]);
  assert.deepEqual(g.hsn.map((r) => r.recipient), ['b2b', 'b2c']);
  assert.deepEqual(g.hsn.map((r) => r.taxable), [100, 100]);
});
test('GSTR-1 applies intra/inter tax columns without cross-over', () => {
  const g = build([invoice('I'), invoice('O', { supply: 'inter' })]);
  assert.equal(g.totals.cgst, 9);
  assert.equal(g.totals.sgst, 9);
  assert.equal(g.totals.igst, 18);
});
test('draft JSON combines same B2CL invoice with two tax rates into one invoice', () => {
  const r = invoice('99', { gstin: '', supply: 'inter', grandTotal: 160000, taxable: 160000,
    byRate: [{ rate: 5, taxable: 100000, tax: 5000 }, { rate: 12, taxable: 60000, tax: 7200 }] });
  const out = gstr1Json(build([r]));
  assert.match(out._notice, /REVIEW ONLY/);
  assert.equal(out.b2cl.length, 1);
  assert.equal(out.b2cl[0].inv.length, 1);
  assert.deepEqual(out.b2cl[0].inv[0].itms.map((x) => x.itm_det.rt), [5, 12]);
});
test('review JSON separates HSN B2B and B2C', () => {
  const draft = gstr1Json(build([invoice('B'), invoice('C', { gstin: '' })]));
  assert.equal(draft.hsn.b2b.length, 1);
  assert.equal(draft.hsn.b2c.length, 1);
  assert.equal(draft.fp, '102026');
});
test('GSTR1 CSV is a single valid table with category per row and header once', () => {
  const csv = gstr1Csv(build([invoice('B'), invoice('C', { gstin: '' })]));
  const rows = csv.split('\r\n');
  assert.match(rows[0], /^section,invoice,date,gstin,pos/);
  assert.equal(rows.filter((r) => r.startsWith('section,')).length, 1);
  assert.ok(rows.some((r) => r.startsWith('HSN B2B,')));
  assert.ok(rows.some((r) => r.startsWith('HSN B2C,')));
});
test('CSV neutralizes spreadsheet formula strings and escapes embedded line breaks', () => {
  const csv = toCsv([{ name: '=HYPERLINK("evil")', note: 'A,B\nC', amount: -30 }, { name: '+SUM(1,2)', note: '@cmd', amount: 20 }]);
  assert.match(csv, /"'=HYPERLINK\(""evil""\)"/);
  assert.match(csv, /"A,B\nC"/);
  assert.ok(csv.includes("'+SUM(1,2)"));
  assert.ok(csv.includes("'@cmd"));
  assert.ok(csv.includes(',-30'));
});
test('receivables aging includes only open balances and buckets correctly', () => {
  const d = (id, dueDate, balance, status = 'awaiting_payment') => invoice(id, { dueDate, balance, status, customerId: 'customer' });
  const r = receivables([d('a','2026-10-10',80), d('b','2026-09-30',20), d('c','2026-08-01',10), d('d','2026-10-01',0,'paid'), d('e','2026-10-01',40,'cancelled')], '2026-10-09');
  assert.equal(r.length, 1);
  assert.equal(r[0].current, 80);
  assert.equal(r[0].d30, 20);
  assert.equal(r[0].d90, 10);
  assert.equal(r[0].total, 110);
  assert.equal(r[0].invoices, 3);
});
test('sales register includes cancellation for reconciliation and item margins do not', () => {
  const arr = [invoice('a'), invoice('b', { status: 'cancelled' })];
  assert.equal(salesRegister(arr).length, 2);
  const r = itemSales(arr, () => 30);
  assert.equal(r.length, 1);
  assert.equal(r[0].cost, 60);
  assert.equal(r[0].margin, 40);
});
