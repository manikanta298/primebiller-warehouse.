import test from 'node:test';
import assert from 'node:assert/strict';
import { gstinCheckChar } from '../src/lib/gst.ts';
import { normaliseGodown, godownProblems, filterWarehouses, warehouseStockSummary, canDeactivateWarehouse } from '../src/lib/godown-rules.ts';

const blank = { code: ' HYD-01 ', name: ' Hyderabad ', type: 'godown', address: ' Balanagar ', stateCode: '36', gstin: '', manager: ' M ', allowNegative: false, defaultForSales: false, active: true };

test('normalisation trims names and uppercases warehouse codes without changing identity', () => {
  const normal = normaliseGodown(blank);
  assert.equal(normal.code, 'HYD-01');
  assert.equal(normal.name, 'Hyderabad');
  assert.equal(normal.manager, 'M');
  assert.equal(normal.id, undefined);
  assert.deepEqual(godownProblems(blank), []);
});

test('codes, name, state and field lengths are validated', () => {
  const errs = godownProblems({ ...blank, code: '! bad', name: ' ', stateCode: '99', manager: 'x'.repeat(121), address: 'x'.repeat(401) });
  for (const label of ['Code', 'name', 'state', 'Manager', 'Address']) assert.ok(errs.some((e) => e.includes(label)), `${label} must fail`);
});

test('GSTIN checksum and prefix must correspond to the warehouse state', () => {
  assert.ok(godownProblems({ ...blank, gstin: 'garbage' }).some((s) => s.includes('GSTIN')));
  // Use a valid calculated check digit, but attach the number to the wrong state.
  const base = '36AAXFS1234K1Z';
  const gstin = base + gstinCheckChar(base);
  assert.deepEqual(godownProblems({ ...blank, gstin, stateCode: '36' }), []);
  assert.ok(godownProblems({ ...blank, gstin, stateCode: '37' }).some((s) => s.includes('GSTIN state')));
});

test('warehouse GSTIN accepts NA case-insensitively while retaining blank and state validation', () => {
  for (const gstin of ['NA', 'na', ' Na ']) {
    assert.equal(normaliseGodown({ ...blank, gstin }).gstin, 'NA');
    assert.deepEqual(godownProblems({ ...blank, gstin }), []);
  }
  for (const gstin of ['', '   ', undefined]) {
    assert.equal(normaliseGodown({ ...blank, gstin }).gstin, undefined);
    assert.deepEqual(godownProblems({ ...blank, gstin }), []);
  }
  assert.ok(godownProblems({ ...blank, gstin: 'NA', stateCode: '99' }).some((s) => s.includes('state')));
  for (const gstin of ['N/A', 'NAA', 'NOT APPLICABLE', '36AAXFS1234K1Z0']) {
    assert.ok(godownProblems({ ...blank, gstin }).some((s) => s.includes('GSTIN')));
  }
});

test('inactive warehouses cannot be selected as the sales default', () => {
  assert.ok(godownProblems({ ...blank, active: false, defaultForSales: true }).some((s) => s.includes('default')));
});

test('deactivation checks every item including negative inventory and held reservations', () => {
  assert.equal(canDeactivateWarehouse([{ onHand: 10, held: 0 }, { onHand: -10, held: 0 }]), false);
  assert.equal(canDeactivateWarehouse([{ onHand: 0, held: 1 }]), false);
  assert.equal(canDeactivateWarehouse([{ onHand: 0, held: 0 }]), true);
});

test('warehouse aggregate counts active stocked SKUs and calculates held/free/value', () => {
  const items = [
    { costPrice: 20, stock: [{ godownId: 'g1', onHand: 10, held: 2 }] },
    { costPrice: 6, stock: [{ godownId: 'g1', onHand: -2, held: 0 }] },
    { costPrice: 12, stock: [{ godownId: 'g2', onHand: 99, held: 0 }] },
    { costPrice: 1, stock: [{ godownId: 'g1', onHand: 0, held: 0 }] },
  ];
  assert.deepEqual(warehouseStockSummary(items, 'g1'), { onHand: 8, held: 2, available: 6, itemCount: 2, stockValue: 188 });
});

test('warehouse searches are case-insensitive across address, manager, type and code', () => {
  const gs = [
    { name: 'Balanagar', code: 'BLN', manager: 'Ramesh', address: 'Hyderabad', type: 'godown', active: true },
    { name: 'Yard', code: 'YRD', manager: 'Other', address: 'Vijayawada', type: 'yard', active: false },
  ];
  assert.equal(filterWarehouses(gs, 'ramesh hyderabad', 'active').length, 1);
  assert.equal(filterWarehouses(gs, '', 'inactive')[0].code, 'YRD');
  assert.deepEqual(filterWarehouses(gs, 'JDOESNOTMATCH', 'all'), []);
});
