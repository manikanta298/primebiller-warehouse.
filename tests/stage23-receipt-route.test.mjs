import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

test('read-only receipt detail API has tenant-scoped lookup, permission check and 404 handling', () => {
  const source = readFileSync(new URL('../backend/src/routes/sales.ts', import.meta.url), 'utf8');
  const route = source.indexOf('salesRouter.get("/receipts/:id"');
  const advance = source.indexOf('salesRouter.get("/receipts/advances"');
  const post = source.indexOf('salesRouter.post("/receipts"');
  assert.ok(route > advance && route < post, 'reserved /receipts/advances path must not be captured by :id');
  const block = source.slice(route, post);
  assert.match(block, /requirePerm\(u\.ctx, "recordReceipt"/);
  assert.match(block, /u\.doc\("receipts", String\(req\.params\["id"\]\)\)/);
  assert.match(block, /ApiError\(404, "not_found"/);
  assert.ok(!/u\.put\(|write\(req/.test(block));
});
