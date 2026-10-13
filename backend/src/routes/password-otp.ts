import {Router} from "express";
import {randomBytes,randomInt,createHmac,timingSafeEqual} from "node:crypto";
import bcrypt from "bcryptjs";
import {z} from "zod";
import {exec,one,pool,withTransaction} from "../db.js";
import {config} from "../config.js";
import {h} from "../http.js";
import {ApiError} from "../errors.js";
import {sendPasswordResetOtp,smtpConfigured} from "../smtp.js";

export const passwordOtpRouter=Router();
const notice="If an active account exists and the request limit has not been reached, a reset OTP is available through the configured delivery channel.";
const emailInput=z.object({email:z.string().trim().email().max(190).transform(v=>v.toLowerCase())}).strict();
const resetInput=z.object({requestId:z.string().regex(/^[a-f0-9]{64}$/),otp:z.string().regex(/^\d{6}$/),password:z.string().min(10).max(128)}).strict();
export const otpDigest=(requestId:string,userId:string,otp:string)=>createHmac("sha256",config.jwtSecret).update(`password-reset:${requestId}:${userId}:${otp}`).digest("hex");

passwordOtpRouter.post("/forgot-password-otp",h(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const {email}=emailInput.parse(req.body);
  if(!smtpConfigured())throw new ApiError(503,"mail_unavailable","Password recovery delivery is not configured");
  const requestId=randomBytes(32).toString("hex"),otp=String(randomInt(0,1_000_000)).padStart(6,"0");
  const issued=await withTransaction(async conn=>{
    const user=await one(conn,"SELECT id, token_version FROM users WHERE email = ? AND active = 1 AND password_hash IS NOT NULL FOR UPDATE",[email]);
    if(!user)return false;
    const recent=await one(conn,"SELECT COUNT(*) AS n FROM password_reset_otp_challenges WHERE user_id = ? AND requested_at > UTC_TIMESTAMP() - INTERVAL 15 MINUTE",[user["id"]]);
    if(Number(recent?.["n"] ?? 0)>=3)return false;
    await exec(conn,"UPDATE password_reset_otp_challenges SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",[user["id"]]);
    await exec(conn,`INSERT INTO password_reset_otp_challenges
      (request_id,user_id,otp_hash,user_token_version,requested_at,expires_at)
      VALUES (?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP() + INTERVAL 10 MINUTE)`,[requestId,user["id"],otpDigest(requestId,user["id"],otp),user["token_version"]]);
    return true;
  });
  if(issued){
    try{await sendPasswordResetOtp(email,otp,requestId);}
    catch{await exec(pool,"UPDATE password_reset_otp_challenges SET used_at = UTC_TIMESTAMP() WHERE request_id = ?",[requestId]);console.error("Password reset OTP delivery failed");}
  }
  // A random reference is returned for unknown/throttled accounts too; no OTP leaves this API.
  return {message:notice,requestId,expiresInSeconds:600,delivery:config.mailDeliveryMode};
}));

passwordOtpRouter.post("/reset-password-otp",h(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  const {requestId,otp,password}=resetInput.parse(req.body);
  const changed=await withTransaction(async conn=>{
    const candidate=await one(conn,"SELECT user_id FROM password_reset_otp_challenges WHERE request_id = ?",[requestId]);
    if(!candidate)return false;
    // Lock users before challenges in both issue/reset paths to avoid inverted lock ordering.
    const user=await one(conn,"SELECT id, active, token_version FROM users WHERE id = ? FOR UPDATE",[candidate["user_id"]]);
    const challenge=await one(conn,`SELECT otp_hash,user_token_version,attempts,used_at,
      expires_at > UTC_TIMESTAMP() AS unexpired FROM password_reset_otp_challenges
      WHERE request_id = ? AND user_id = ? FOR UPDATE`,[requestId,candidate["user_id"]]);
    if(!user?.["active"]||!challenge||challenge["used_at"]||!challenge["unexpired"]||Number(challenge["attempts"])>=5||Number(challenge["user_token_version"])!==Number(user["token_version"]))return false;
    const expected=otpDigest(requestId,user["id"],otp),stored=String(challenge["otp_hash"]);
    const valid=/^[a-f0-9]{64}$/.test(stored)&&timingSafeEqual(Buffer.from(stored,"hex"),Buffer.from(expected,"hex"));
    if(!valid){await exec(conn,"UPDATE password_reset_otp_challenges SET attempts = attempts + 1 WHERE request_id = ?",[requestId]);return false;}
    const hash=await bcrypt.hash(password,12);
    await exec(conn,"UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",[hash,user["id"]]);
    await exec(conn,"UPDATE password_reset_otp_challenges SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",[user["id"]]);
    await exec(conn,"UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL",[user["id"]]);
    return true;
  });
  // Throw after committing wrong-attempt increments; rolling them back would defeat the limit.
  if(!changed)throw new ApiError(400,"invalid_otp","OTP is invalid, expired, already used or has reached its attempt limit. Request a new OTP if needed.");
  return {message:"Your password has been updated. Sign in with your new password."};
}));
