/**
 * E-way bill generation. NOT connected to a real GSP yet.
 *
 * To go live, call your GSP's "generate EWB" API here using the provider, username,
 * client id and (decrypted) secret saved under Settings → E-way bill provider, and send
 * the idempotency key `dc-{challanId}-ewb` so a retry never creates a second bill.
 * Until then this returns a clearly fake number starting with "TEST" so nobody mistakes
 * it for a real e-way bill.
 */
import type { Uow } from "./uow.js";
import type { Challan } from "./shared/types.js";

export async function generateEwb(_u: Uow, c: Challan): Promise<string> {
  const idempotencyKey = `dc-${c.id}-ewb`;
  void idempotencyKey;
  return `TEST${String(Date.now()).slice(-8)}`;
}
