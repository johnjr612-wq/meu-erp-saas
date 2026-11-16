"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction, resetPasswordAction, type ResetFormState } from "./actions";

function Field({ name, label, state, ...props }: { name: string; label: string; state: ResetFormState } & React.ComponentProps<"input">) {
  const errors = state?.fieldErrors?.[name];
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!errors} {...props} />
      {errors?.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

export function RequestResetForm() {
  const [state, action] = useActionState(requestResetAction, null);
  if (state?.ok) {
    return (
      <p role="status" className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
        Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora. Confira
        também a caixa de spam.
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <Field name="email" label="E-mail da sua conta" type="email" autoComplete="email" required state={state} />
      <SubmitButton label="Enviar link" />
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <Field name="password" label="Nova senha" type="password" autoComplete="new-password" required state={state} />
      <Field name="confirm" label="Repita a nova senha" type="password" autoComplete="new-password" required state={state} />
      {state?.error && (
        <p role="status" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <SubmitButton label="Salvar nova senha" />
    </form>
  );
}
