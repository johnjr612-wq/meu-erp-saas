"use client";

import { createContext, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
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
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    (_prev, formData) => action(formData),
    null,
  );

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <FieldErrorsContext.Provider value={state && !state.ok ? (state.fieldErrors ?? {}) : {}}>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={(e) => {
          if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
        }}
        className={cn("grid gap-3", className)}
      >
        <input type="hidden" name="orgSlug" value={orgSlug} />
        {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {children}
        <div className="flex items-center gap-3">
          <SubmitButton label={submitLabel} variant={submitVariant} />
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
}: {
  label: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
}) {
  const { pending } = useFormStatus();
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
