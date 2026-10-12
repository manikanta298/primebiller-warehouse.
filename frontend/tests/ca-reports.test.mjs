import test from 'node:test';
import assert from 'node:assert/strict';
import {CA_ROLE} from '../src/api/types.ts';
import {PERMISSIONS,can,isReadOnlyRole} from '../src/lib/permissions.ts';
import {userProblems} from '../src/lib/admin-rules.ts';
import {buildGstr3bWorkpaper,gstr3bWorkpaperCsv} from '../src/lib/ca-reports.ts';

test('CA role gets only the audit permission and can be invited without warehouse assignments',()=>{
 assert.equal(isReadOnlyRole(CA_ROLE),true);
 for(const permission of Object.keys(PERMISSIONS))assert.equal(can(CA_ROLE,permission),permission==='caAudit',permission);
 const input={name:'CA Reviewer',email:'ca@example.com',mobile:'',role:CA_ROLE,godownIds:[],active:true};
 assert.deepEqual(userProblems(input,['g1'],[]),[]);
 assert.ok(userProblems({...input,role:'Accountant'},['g1'],[]).length);
 assert.ok(userProblems({...input,godownIds:['foreign']},['g1'],[]).length);
});
test('3B workpaper retains tax components, excludes cancelled/outside-period invoices and preserves unknown sections',()=>{
 const invoice={date:'2026-10-01',status:'paid',gstin:'',supply:'inter',placeOfSupplyCode:'37',cgst:0,sgst:0,igst:18,byRate:[{rate:18,taxable:100,tax:18},{rate:0,taxable:20,tax:0}]};
 const input=[invoice,{...invoice,date:'2026-09-30'},{...invoice,status:'cancelled'},{...invoice,gstin:'36TEST',supply:'intra',cgst:9,sgst:9,igst:0}];
 const original=JSON.stringify(input),report=buildGstr3bWorkpaper(input,'2026-10');
 assert.deepEqual(report.outwardTaxableFromBooks,{taxable:200,cgst:9,sgst:9,igst:18});
 assert.equal(report.invoiceCount,2);assert.equal(report.cancelledCount,1);assert.equal(report.unclassifiedZeroRateTaxable,40);
 assert.deepEqual(report.interstateUnregisteredFromBooks,[{placeOfSupply:'37',taxable:100,igst:18}]);
 assert.equal(report.pendingReview.eligibleItc,null);assert.equal(report.pendingReview.reverseCharge,null);
 assert.match(gstr3bWorkpaperCsv(report),/PENDING_REVIEW/);assert.equal(JSON.stringify(input),original);
});
