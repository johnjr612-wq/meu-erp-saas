"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, registerAction, type AuthFormState } from "./actions";

function Field({
  name,
  label,
  state,
  ...props
}: { name: string; label: string; state: AuthFormState } & React.ComponentProps<"input">) {
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

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
      <Field name="email" label="E-mail" type="email" autoComplete="email" required state={state} />
      <Field name="password" label="Senha" type="password" autoComplete="current-password" required state={state} />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton label="Entrar" />
    </form>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);
  return (
    <form action={action} className="grid gap-4">
      <Field name="name" label="Seu nome" required state={state} />
      <Field name="email" label="E-mail" type="email" autoComplete="email" required state={state} />
      <Field name="password" label="Senha" type="password" autoComplete="new-password" required state={state} />
      <Field name="orgName" label="Nome da empresa" required state={state} />
      <Field name="orgSlug" label="Endereço (ex.: limpa-tudo)" required state={state} />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <SubmitButton label="Criar conta" />
    </form>
  );
}
