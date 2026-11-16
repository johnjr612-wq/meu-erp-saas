"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";

type Option = { id: string; label: string };
type Line = { key: number; itemId: string; quantity: string };

/**
 * Formulário "cabeçalho + itens" (pedido de venda, fórmula de produção...).
 * Os campos do cabeçalho vêm como children; os itens viram um array `items`
 * com `{ [itemField]: id, quantity }`. Validação final acontece no servidor (Zod).
 */
export function LineItemsForm({
  action,
  orgSlug,
  options,
  itemField,
  itemLabel,
  submitLabel,
  children,
  initialLines,
  resetOnSuccess = true,
}: {
  action: (input: Record<string, unknown>) => Promise<ActionResult>;
  orgSlug: string;
  options: Option[];
  itemField: string;
  itemLabel: string;
  submitLabel: string;
  children: ReactNode;
  /** Itens já existentes (telas de edição). */
  initialLines?: { itemId: string; quantity: string }[];
  /** Limpa o formulário após sucesso (false em telas de edição). */
  resetOnSuccess?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(() =>
    initialLines?.length
      ? initialLines.map((l, i) => ({ key: i, ...l }))
      : [{ key: 0, itemId: "", quantity: "" }],
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const header: Record<string, unknown> = {};
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v === "string" && v.trim() !== "") header[k] = v;
    }
    const items = lines
      .filter((l) => l.itemId && l.quantity)
      .map((l) => ({ [itemField]: l.itemId, quantity: l.quantity }));

    startTransition(async () => {
      const res = await action({ ...header, orgSlug, items });
      setResult(res);
      if (res.ok && resetOnSuccess) {
        form.reset();
        setLines([{ key: Date.now(), itemId: "", quantity: "" }]);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {children}
      <div className="grid gap-2">
        <p className="text-sm font-medium">{itemLabel}</p>
        {lines.map((line) => (
          <div key={line.key} className="flex gap-2">
            <NativeSelect
              aria-label={itemLabel}
              value={line.itemId}
              onChange={(e) => update(line.key, { itemId: e.target.value })}
            >
              <option value="">Selecione...</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <Input
              aria-label="Quantidade"
              placeholder="Qtd."
              inputMode="decimal"
              className="w-28"
              value={line.quantity}
              onChange={(e) => update(line.key, { quantity: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover item"
              disabled={lines.length === 1}
              onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setLines((ls) => [...ls, { key: Date.now(), itemId: "", quantity: "" }])}
        >
          <Plus /> Adicionar item
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
        {result && (
          <p role="status" className={result.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
            {result.ok
              ? (result.message ?? "Salvo.")
              : [result.error, ...Object.values(result.fieldErrors ?? {}).flat()].filter(Boolean).join(" ")}
          </p>
        )}
      </div>
    </form>
  );
}
