import test from 'node:test';
import assert from 'node:assert/strict';
import { gstinCheckChar } from '../src/lib/gst.ts';
import { normaliseParty, partyProblems, duplicatePartyGstin, filterParties, partyCreditSummary, partyStateName, partiesForOrg } from '../src/lib/party-rules.ts';

const validGstin = '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z');
const base = { kind: 'customer', name: ' Rajesh Constructions ', tradeName: ' Registered ', gstin: validGstin.toLowerCase(), pan: '', phone: '+91 99999-99999', email: ' ADMIN@EXAMPLE.COM ', address: ' Street ', city: ' Hyderabad ', pin: '500037', stateCode: '36', creditLimit: 100000, creditDays: 30, blocked: false };

test('party drafts normalise identity, GST and contact fields without financial fields', () => {
  const p = normaliseParty(base);
  assert.equal(p.name, 'Rajesh Constructions');
  assert.equal(p.email, 'admin@example.com');
  assert.equal(p.gstin, validGstin);
  assert.equal(p.pan, 'AAXFS1234K');
  assert.equal(p.address, 'Street');
  assert.deepEqual(partyProblems(base), []);
});

test('invalid name, state, email, PIN, phone and PAN are rejected', () => {
  const problems = partyProblems({ ...base, name: ' ', stateCode: '99', gstin: '', pan: 'ZZ', pin: '123', phone: 'not-a-number', email: 'bad@@mail' });
  for (const part of ['Party name', 'state code', 'email', 'PIN', 'contact', 'PAN']) {
    assert.ok(problems.some((p) => p.includes(part)), `Expected ${part}`);
  }
});

test('GSTIN must be checksum-valid, match state and match PAN', () => {
  assert.ok(partyProblems({ ...base, gstin: validGstin.slice(0, 14) + (validGstin[14] === '0' ? '1' : '0') }).some((e) => e.includes('GSTIN')));
  assert.ok(partyProblems({ ...base, stateCode: '37' }).some((e) => e.includes('GSTIN state')));
  assert.ok(partyProblems({ ...base, pan: 'ABCDE1234F' }).some((e) => e.includes('PAN must match')));
});

test('zero credit is allowed; non-finite, negative, fractional days and excess precision rejected', () => {
  assert.deepEqual(partyProblems({ ...base, gstin: '', creditLimit: 0, creditDays: 0 }), []);
  for (const value of [-1, Number.POSITIVE_INFINITY, 1.234]) assert.ok(partyProblems({ ...base, creditLimit: value }).some((e) => e.includes('Credit limit')));
  for (const value of [0.5, -1, 9999]) assert.ok(partyProblems({ ...base, creditDays: value }).some((e) => e.includes('Credit days')));
});

test('duplicate GSTIN check excludes self and includes only supplied organisation candidates', () => {
  const same = { id: 'p1', gstin: validGstin, name: 'Existing' };
  assert.equal(duplicatePartyGstin([same], { ...base, id: 'p1' }), undefined);
  assert.equal(duplicatePartyGstin([same], { ...base, id: 'p2' })?.id, 'p1');
  assert.equal(duplicatePartyGstin([], base), undefined);
  assert.equal(duplicatePartyGstin([same], { ...base, gstin: '' }), undefined);
});

test('type filtering includes dual-role customer/suppliers without including unrelated types', () => {
  const rows = ['customer', 'supplier', 'both', 'transporter'].map((kind, i) => ({ id: `p${i}`, kind, name: `Party ${i}`, city: 'Hyd', gstin: undefined, phone: '', stateName: 'Telangana', creditLimit: 0, outstanding: 0, blocked: i === 2 }));
  assert.deepEqual(filterParties(rows, 'customer', '', 'all').map((p) => p.kind), ['customer', 'both']);
  assert.deepEqual(filterParties(rows, 'supplier', '', 'all').map((p) => p.kind), ['supplier', 'both']);
  assert.deepEqual(filterParties(rows, 'both', '', 'all').map((p) => p.kind), ['both']);
  assert.deepEqual(filterParties(rows, 'all', '', 'blocked').map((p) => p.kind), ['both']);
  assert.equal(filterParties(rows, 'all', 'PARTY 3 hyd', 'unblocked').length, 1);
});

test('unlimited credit does not report a tight credit warning; overdrawn balances show negative headroom', () => {
  assert.deepEqual(partyCreditSummary({ creditLimit: 0, outstanding: 50 }), { headroom: -50, nearLimit: false });
  assert.deepEqual(partyCreditSummary({ creditLimit: 100, outstanding: 105 }), { headroom: -5, nearLimit: true });
});

test('GST state name covers Telangana and Andhra Pradesh', () => {
  assert.equal(partyStateName('36'), 'Telangana');
  assert.equal(partyStateName('37'), 'Andhra Pradesh');
});

test('organisation ownership isolates demo party lists, ID reads and duplicate checks', () => {
  const records = [{ id: 'a', name: 'Org One', gstin: validGstin }, { id: 'b', name: 'Org Two', gstin: validGstin }];
  const owner = { a: 'org1', b: 'org2' };
  assert.deepEqual(partiesForOrg(records, owner, 'org1').map((p) => p.id), ['a']);
  assert.deepEqual(partiesForOrg(records, owner, 'org2').map((p) => p.id), ['b']);
  assert.equal(partiesForOrg(records, owner, 'org1').find((p) => p.id === 'b'), undefined);
  assert.equal(duplicatePartyGstin(partiesForOrg(records, owner, 'org1'), { ...base, id: 'a' }), undefined);
  assert.equal(partiesForOrg(records, owner, '').length, 0);
});
