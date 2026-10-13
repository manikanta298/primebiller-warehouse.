import {useState} from "react";
import {useMutation} from "@tanstack/react-query";
import {api} from "@/api/client";
import {setSession} from "@/lib/session";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

export function PasswordOtpRecovery({initialEmail,onBack}:{initialEmail:string;onBack:()=>void}){
  const [email,setEmail]=useState(initialEmail),[otp,setOtp]=useState("");
  const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState("");
  const [challenge,setChallenge]=useState<{requestId:string;delivery:"console"|"smtp"}|null>(null);
  const [complete,setComplete]=useState(false),[error,setError]=useState("");
  const request=useMutation({mutationFn:()=>api.requestPasswordOtp(email),onSuccess:response=>{setChallenge(response);setOtp("");setError("");},onError:(e:Error)=>setError(e.message)});
  const reset=useMutation({mutationFn:()=>api.resetPasswordOtp(challenge!.requestId,otp,password),onSuccess:()=>{setSession(null);setComplete(true);setOtp("");setPassword("");setConfirmation("");setError("");},onError:(e:Error)=>setError(e.message)});
  const pending=request.isPending||reset.isPending;
  if(complete)return <div className="space-y-5"><h1 className="text-2xl font-semibold">Password updated</h1><p className="text-sm text-muted-foreground">Sign in with your new password. Earlier sessions have been signed out.</p><Button className="w-full" onClick={onBack}>Back to sign in</Button></div>;
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Forgot password?</h1>
    {challenge ? <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(/^\d{6}$/.test(otp)&&password.length>=10&&password.length<=128&&password===confirmation&&!pending){setError("");reset.mutate();}}}>
      <p className="text-sm text-muted-foreground">If an active account exists, {challenge.delivery==="console" ? "ask the service administrator for the OTP from the Render server logs." : "check your email for the OTP."} The code expires in 10 minutes. Only the most recently issued code works.</p>
      <p className="text-xs text-muted-foreground">Request reference: <span className="font-mono">{challenge.requestId.slice(-8)}</span></p>
      <div className="space-y-2"><Label htmlFor="reset-otp">6-digit OTP</Label><Input id="reset-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,""))} required /></div>
      <div className="space-y-2"><Label htmlFor="otp-new-password">New password</Label><Input id="otp-new-password" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required /><p className="text-xs text-muted-foreground">Use 10–128 characters.</p></div>
      <div className="space-y-2"><Label htmlFor="otp-confirm-password">Confirm new password</Label><Input id="otp-confirm-password" type="password" autoComplete="new-password" maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)} required />{confirmation&&confirmation!==password&&<p className="text-xs text-destructive">Passwords do not match.</p>}</div>
      <Button className="w-full" type="submit" disabled={pending||otp.length!==6||password.length<10||password!==confirmation}>{reset.isPending?"Updating…":"Update password"}</Button>
      <Button className="w-full" type="button" variant="outline" disabled={pending} onClick={()=>{setError("");request.mutate();}}>Request new OTP</Button>
      <p className="text-xs text-muted-foreground">Maximum three requests per account in 15 minutes. Five incorrect attempts lock a code.</p>
    </form> : <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!pending){setError("");request.mutate();}}}>
      <p className="text-sm text-muted-foreground">Enter your account email to request a password reset OTP.</p>
      <div className="space-y-2"><Label htmlFor="otp-recovery-email">Email</Label><Input id="otp-recovery-email" type="email" autoComplete="email" maxLength={190} value={email} onChange={e=>setEmail(e.target.value)} required /></div>
      <Button className="w-full" type="submit" disabled={pending}>{request.isPending?"Requesting…":"Request OTP"}</Button>
    </form>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="button" className="min-h-11 text-sm text-primary hover:underline" disabled={pending} onClick={onBack}>Back to sign in</button>
  </div>;
}
