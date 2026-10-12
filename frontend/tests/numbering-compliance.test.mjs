import test from 'node:test';
import assert from 'node:assert/strict';
import {docNumber,fyLabel,invoiceNumberProblems,seriesProblems} from '../src/lib/numbering.ts';
test('invoice numbering validates actual length, symbols and financial-year boundary',()=>{
 assert.equal(fyLabel('2026-03-31'),'25-26');
 assert.equal(fyLabel('2026-04-01'),'26-27');
 assert.deepEqual(invoiceNumberProblems(docNumber('INV','26-27',1,5)),[]);
 assert.deepEqual(invoiceNumberProblems('ABCD/26-27/00001'),[]);
 for(const number of ['', 'INV_26/1','INV 26/1','ABCDEF/26-27/000001']) assert.ok(invoiceNumberProblems(number).length);
 assert.ok(invoiceNumberProblems(docNumber('ABCD','26-27',1000000,5)).length);
});
test('new invoice series cannot be configured over length; other document series remain compatible',()=>{
 const current={prefix:'INV',padding:5,lastNumber:0};
 assert.ok(seriesProblems({docType:'INV',prefix:'ABCDEF',padding:6},current).length);
 assert.deepEqual(seriesProblems({docType:'INV',prefix:'INV',padding:6},current),[]);
 assert.deepEqual(seriesProblems({docType:'SO',prefix:'ABCDEF',padding:6},current),[]);
});
