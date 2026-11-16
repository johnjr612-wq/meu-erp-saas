"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";

type FieldErrors = Record<string, string[] | undefined>;
const FieldErrorsContext = createContext<FieldErrors>({});

/**
 * Formulário genérico para Server Actions criadas com `createAction`.
 * Injeta `orgSlug`, exibe erros de validação por campo e mensagem de sucesso.
 * Não conhece banco de dados: recebe a action pronta por props.
 */
export function ActionForm({
  action,
  orgSlug,
  submitLabel = "Salvar",
  hidden,
  children,
  className,
  submitVariant,
  confirmMessage,
  resetOnSuccess = true,
}: {
  action: (input: FormData) => Promise<ActionResult>;
  orgSlug: string;
  submitLabel?: string;
  hidden?: Record<string, string>;
  children?: ReactNode;
  className?: string;
  submitVariant?: "default" | "outline" | "destructive" | "secondary";
  /** Pede confirmação antes de enviar (ações destrutivas). */
  confirmMessage?: string;
  /** Limpa o formulário após sucesso (false em telas de edição). */
  resetOnSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    (_prev, formData) => action(formData),
    null,
  );

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <FieldErrorsContext.Provider value={state && !state.ok ? (state.fieldErrors ?? {}) : {}}>
      {/*
        Envio via onSubmit (e não <form action>): o React 19 limpa formulários com action
        após cada envio, inclusive com erro — o usuário perderia o que digitou.
      */}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          const formData = new FormData(e.currentTarget);
          startTransition(() => formAction(formData));
        }}
        className={cn("grid gap-3", className)}
      >
        <input type="hidden" name="orgSlug" value={orgSlug} />
        {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {children}
        <div className="flex items-center gap-3">
          <SubmitButton label={submitLabel} variant={submitVariant} pending={pending} />
          {state && (
            <p role="status" className={cn("text-sm", state.ok ? "text-emerald-600" : "text-destructive")}>
              {state.ok ? (state.message ?? "Salvo.") : state.error}
            </p>
          )}
        </div>
      </form>
    </FieldErrorsContext.Provider>
  );
}

export function SubmitButton({
  label,
  variant,
  pending: pendingProp,
}: {
  label: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  /** Para formulários enviados via onSubmit (useFormStatus só enxerga <form action>). */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" disabled={pending} variant={variant} size={variant === "outline" ? "sm" : "default"}>
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

/** Campo com label e erro vindo da validação Zod do servidor. */
export function FormField({
  name,
  label,
  children,
  ...inputProps
}: { name: string; label: string; children?: ReactNode } & React.ComponentProps<"input">) {
  const errors = useContext(FieldErrorsContext)[name];
  const inputId = inputProps.id ?? name;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {children ?? <Input name={name} aria-invalid={!!errors} {...inputProps} id={inputId} />}
      {errors?.map((e) => (
        <p key={e} className="text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}
