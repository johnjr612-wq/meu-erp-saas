"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import { FormField, SubmitButton } from "@/components/forms/action-form";
import type { ActionResult } from "@/lib/action";

type PaymentResult = ActionResult<{ paymentUrl: string | null }>;

function useRedirectingAction(action: (input: FormData) => Promise<PaymentResult>) {
  return useActionState<PaymentResult | null, FormData>(async (_prev, fd) => {
    const res = await action(fd);
    // Fatura do Asaas: o cliente escolhe Pix, boleto ou cartão lá.
    if (res.ok && res.data.paymentUrl) window.location.assign(res.data.paymentUrl);
    return res;
  }, null);
}

function Feedback({ state }: { state: PaymentResult | null }) {
  if (!state) return null;
  if (!state.ok) {
    const fieldMsgs = Object.values(state.fieldErrors ?? {}).flat();
    return (
      <p role="status" className="text-sm text-destructive">
        {fieldMsgs.length ? fieldMsgs.join(" ") : state.error}
      </p>
    );
  }
  return (
    <p role="status" className="text-sm text-emerald-600">
      {state.data.paymentUrl ? (
        <>
          Abrindo a fatura…{" "}
          <a href={state.data.paymentUrl} className="inline-flex items-center gap-1 underline">
            clique aqui se não abrir <ExternalLink className="size-3" />
          </a>
        </>
      ) : (
        "Assinatura registrada. A fatura será enviada por e-mail pelo Asaas."
      )}
    </p>
  );
}

export function SubscribeForm({
  action,
  orgSlug,
  plan,
  label,
  defaultDocument,
}: {
  action: (input: FormData) => Promise<PaymentResult>;
  orgSlug: string;
  plan: string;
  label: string;
  defaultDocument?: string | null;
}) {
  const [state, formAction] = useRedirectingAction(action);
  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="plan" value={plan} />
      <FormField
        name="cpfCnpj"
        id={`cpfCnpj-${plan}`}
        label="CPF ou CNPJ do pagador"
        defaultValue={defaultDocument ?? ""}
        inputMode="numeric"
        required
      />
      <SubmitButton label={label} />
      <Feedback state={state} />
    </form>
  );
}

export function OpenInvoiceButton({
  action,
  orgSlug,
}: {
  action: (input: FormData) => Promise<PaymentResult>;
  orgSlug: string;
}) {
  const [state, formAction] = useRedirectingAction(action);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <SubmitButton label="Pagar fatura em aberto" />
      {state?.ok && !state.data.paymentUrl ? (
        <p className="text-sm text-muted-foreground">Nenhuma fatura em aberto no momento.</p>
      ) : (
        <Feedback state={state} />
      )}
    </form>
  );
}
