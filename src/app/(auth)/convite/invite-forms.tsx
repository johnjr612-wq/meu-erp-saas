"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInviteAction, acceptInviteWithSignupAction } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInviteAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton label="Aceitar convite" />
    </form>
  );
}

export function SignupInviteForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState(acceptInviteWithSignupAction, null);
  const err = (f: string) =>
    state?.fieldErrors?.[f]?.map((e) => (
      <p key={e} className="text-xs text-destructive">
        {e}
      </p>
    ));
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" value={email} disabled readOnly />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Seu nome</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!state?.fieldErrors?.name} />
        {err("name")}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">Crie uma senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!state?.fieldErrors?.password}
        />
        {err("password")}
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton label="Criar conta e entrar" />
    </form>
  );
}
