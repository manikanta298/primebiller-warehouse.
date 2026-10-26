import { createHmac, timingSafeEqual } from "node:crypto";
export function validSignature(raw: Buffer, signature: string, secret: string) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  return timingSafeEqual(supplied, createHmac("sha256", secret).update(raw).digest());
}
export function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  const left = createHmac("sha256", "verify-token-comparison").update(a).digest();
  const right = createHmac("sha256", "verify-token-comparison").update(b).digest();
  return timingSafeEqual(left, right);
}
