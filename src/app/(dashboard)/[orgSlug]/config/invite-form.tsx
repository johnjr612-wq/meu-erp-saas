"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { FormField, SubmitButton } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";

type InviteResult = ActionResult<{ inviteUrl: string; emailSent: boolean }>;

const ROLE_LABEL: Record<string, string> = { ADMIN: "Administrador", FINANCIAL: "Financeiro", OPERATOR: "Operador" };

/**
 * Convite com link copiável: funciona mesmo sem provedor de e-mail
 * (o link pode ser enviado por WhatsApp). O token só é exibido uma vez.
 */
export function InviteForm({
  action,
  orgSlug,
  roles,
}: {
  action: (input: FormData) => Promise<InviteResult>;
  orgSlug: string;
  roles: readonly string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);
  const [state, formAction] = useActionState<InviteResult | null, FormData>(async (_prev, fd) => {
    const res = await action(fd);
    if (res.ok) formRef.current?.reset();
    setCopied(false);
    return res;
  }, null);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <div className="grid gap-4">
      <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <div className="grid gap-1.5">
          <FormField name="email" label="E-mail" type="email" placeholder="funcionario@empresa.com.br" required />
          {fieldErrors?.email?.map((e) => (
            <p key={e} className="text-xs text-destructive">
              {e}
            </p>
          ))}
        </div>
        <FormField name="role" label="Cargo">
          <NativeSelect id="role" name="role" defaultValue={roles.at(-1)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r] ?? r}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <SubmitButton label="Convidar" />
      </form>

      {state && !state.ok && (
        <p role="status" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state?.ok && (
        <div role="status" className="grid gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
          <p>
            Convite criado.{" "}
            {state.data.emailSent
              ? "Enviamos o link por e-mail — você também pode copiá-lo abaixo."
              : "Copie o link e envie para a pessoa (WhatsApp, e-mail...). Ele não será exibido novamente."}
          </p>
          <div className="flex gap-2">
            <Input readOnly value={state.data.inviteUrl} aria-label="Link do convite" onFocus={(e) => e.target.select()} />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data.inviteUrl);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
