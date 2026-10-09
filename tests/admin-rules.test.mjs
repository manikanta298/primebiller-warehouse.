import test from 'node:test';
import assert from 'node:assert/strict';
import { userProblems, usersForOrg, normaliseUserInput, settingsProblems } from '../src/lib/admin-rules.ts';
import { seriesProblems } from '../src/lib/numbering.ts';
import { gstinCheckChar } from '../src/lib/gst.ts';

const gstin = '36AAXFS1234K1Z' + gstinCheckChar('36AAXFS1234K1Z');
const user = (changes={}) => ({ id: 'u2', name: 'Test', email: 'test@example.com', mobile: '9999999999', role: 'Manager', godownIds: ['g1'], active: true, ...changes });
const staff = [{id:'u1', role:'Owner', active:true}, {id:'u2', role:'Manager', active:true}];
const settings = (changes={}) => ({
  legalName:'Test Traders', tradeName:'Test', gstin, stateCode:'36', pan:'AAXFS1234K', address:'Hyderabad', phone:'', email:'a@example.com',
  bankName:'Test Bank', bankAccount:'123456789', ifsc:'HDFC0001234', invoiceTerms:'', jurisdiction:'',
  fyName:'FY 26-27', fyStart:'2026-04-01', fyEnd:'2027-03-31', fyStatus:'open', composition:false,
  ewbThreshold:50000, einvoiceThreshold:50000000, adjApprovalLimit:1000, roundOff:'nearest_rupee',
  reasonCodes:[{id:'r1',type:'adjustment',code:'DMG',label:'Damaged',active:true}],
  gsp:{provider:'',username:'',clientId:'',sandbox:true,secret:''}, ...changes
});

test('membership isolation only returns users from selected organisation', () => {
  assert.deepEqual(usersForOrg([{id:'a'},{id:'b'},{id:'c'}], {a:['org1'], b:['org2'], c:['org1','org2']}, 'org2').map(u=>u.id), ['b','c']);
});
test('user normalisation removes spaces and lowercases email', () => {
  const out = normaliseUserInput(user({name:' A ',email:' ADMIN@TEST.COM ',mobile:'99999 99999'}));
  assert.equal(out.name, 'A'); assert.equal(out.email, 'admin@test.com'); assert.equal(out.mobile,'9999999999');
});
test('valid user with org warehouse passes', () => { assert.deepEqual(userProblems(user(), ['g1','g2'], staff, 'u1'), []); });
test('optional mobile supports owner accounts created without a number', () => { assert.deepEqual(userProblems(user({ mobile: '' }), ['g1'], staff, 'u1'), []); });
test('invalid user email, mobile and name are rejected', () => {
  const p = userProblems(user({name:' ',email:'foo',mobile:'88'}),['g1'],staff,'u1').join(' ');
  assert.match(p,/Name/); assert.match(p,/email/); assert.match(p,/Mobile/);
});
test('warehouse membership requires valid unique IDs', () => {
  assert.match(userProblems(user({godownIds:['g1','g1']}),['g1'],staff).join(' '),/warehouse/);
  assert.match(userProblems(user({godownIds:['g2']}),['g1'],staff).join(' '),/warehouse/);
});
test('Owner cannot demote or deactivate themself even if another Owner exists', () => {
  const p = userProblems(user({id:'u1',role:'Manager'}), ['g1'], [...staff, {id:'u3',role:'Owner',active:true}], 'u1');
  assert.match(p.join(' '), /own Owner/);
});
test('last active Owner cannot be deactivated by another Owner', () => {
  const p = userProblems(user({id:'u1',role:'Owner',active:false}), ['g1'], staff, 'u9');
  assert.match(p.join(' '), /at least one active Owner/);
});
test('Owner can be demoted if another active Owner remains', () => {
  assert.deepEqual(userProblems(user({id:'u1',role:'Manager'}), ['g1'], [...staff,{id:'u3',role:'Owner',active:true}], 'u9'), []);
});
test('valid settings pass shared validation', () => { assert.deepEqual(settingsProblems(settings()), []); });
test('GSTIN, PAN and state must agree', () => {
  assert.match(settingsProblems(settings({gstin:'invalid'})).join(' '), /GSTIN/);
  assert.match(settingsProblems(settings({pan:'ABCDE1234F'})).join(' '), /PAN/);
  assert.match(settingsProblems(settings({stateCode:'37'})).join(' '), /state/);
});
test('invalid calendar dates and inverted years are rejected', () => {
  for (const x of [{fyStart:'2026-02-30'}, {fyStart:'2027-04-01'}, {fyEnd:'2027-02-30'}])
    assert.match(settingsProblems(settings(x)).join(' '), /financial-year/);
});
test('reason code normalisation collisions and unsafe lengths are rejected', () => {
  const reasonCodes=[{id:'1',type:'return',code:'RTN',label:'Return',active:true},{id:'2',type:'return',code:' rtn ',label:'Other',active:true}];
  assert.match(settingsProblems(settings({reasonCodes})).join(' '),/unique/);
  assert.match(settingsProblems(settings({reasonCodes:[{...reasonCodes[0],code:'BAD SPACE'}]})).join(' '),/Reason/);
});
test('financial limits and bank details have bounds', () => {
  assert.match(settingsProblems(settings({adjApprovalLimit:-2})).join(' '),/Threshold/);
  assert.match(settingsProblems(settings({ifsc:'BAD'})).join(' '),/IFSC/);
  assert.match(settingsProblems(settings({bankAccount:'a1'})).join(' '),/Bank/);
});
test('document series is editable before first issue', () => {
  assert.deepEqual(seriesProblems({docType:'PO',prefix:'PUR',padding:4,resetPerFy:true},{prefix:'PO',padding:4,resetPerFy:true,lastNumber:0}), []);
});
test('any issued document freezes prefix, padding and reset choice', () => {
  for (const change of [{prefix:'X'}, {padding:5}, {resetPerFy:false}]) {
    const input={docType:'PO',prefix:'PO',padding:4,resetPerFy:true,...change};
    const p=seriesProblems(input,{prefix:'PO',padding:4,resetPerFy:true,lastNumber:0,locked:true});
    assert.match(p.join(' '),/locked/);
  }
});
test('series allows an unchanged existing configuration', () => {
  assert.deepEqual(seriesProblems({docType:'INV',prefix:'INV',padding:4,resetPerFy:true},{prefix:'INV',padding:4,resetPerFy:true,lastNumber:10}), []);
});
