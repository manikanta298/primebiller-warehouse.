import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, type FirstAdminRegistrationInput } from "@/api/client";
import type { LoginResponse } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FirstAdminRegistration({ onSuccess, onCancel }: { onSuccess: (auth: LoginResponse) => void; onCancel: () => void }) {
  const [input, setInput] = useState<FirstAdminRegistrationInput>({ name: "", email: "", password: "", mobile: "", setupCode: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const register = useMutation({
    mutationFn: () => api.registerFirstAdmin(input),
    onSuccess: (auth) => onSuccess(auth),
    onError: (error: Error) => toast.error(error.message),
  });
  const update = (key: keyof FirstAdminRegistrationInput, value: string) => setInput((current) => ({ ...current, [key]: value }));
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (input.password === confirmPassword) register.mutate(); }}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Register master admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Create your first administrator with full Owner access. Add business details later in Settings. Registration closes after setup.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-name">Your name</Label>
        <Input id="register-name" value={input.name} onChange={(event) => update("name", event.target.value)} minLength={2} maxLength={120} autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-email">Email</Label>
        <Input id="register-email" type="email" value={input.email} onChange={(event) => update("email", event.target.value)} maxLength={190} autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-mobile">Phone number</Label>
        <Input id="register-mobile" type="tel" value={input.mobile} onChange={(event) => update("mobile", event.target.value)} minLength={7} maxLength={20} autoComplete="tel" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">Password</Label>
        <Input id="register-password" type="password" value={input.password} onChange={(event) => update("password", event.target.value)} minLength={10} maxLength={128} autoComplete="new-password" required />
        <p className="text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-confirm">Confirm password</Label>
        <Input id="register-confirm" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
        {confirmPassword && confirmPassword !== input.password && <p className="text-xs text-destructive">Passwords do not match.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-code">Private setup code</Label>
        <Input id="register-code" type="password" value={input.setupCode} onChange={(event) => update("setupCode", event.target.value)} maxLength={256} autoComplete="off" required />
        <p className="text-xs text-muted-foreground">Enter the setup code saved in your backend hosting settings.</p>
      </div>
      <Button type="submit" className="w-full" disabled={register.isPending || input.password.length < 10 || input.password !== confirmPassword}>
        {register.isPending && <Loader2 className="animate-spin" />} Create master admin
      </Button>
      <button type="button" className="text-sm text-primary hover:underline" onClick={onCancel}>Back to sign in</button>
    </form>
  );
}
