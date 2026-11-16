import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { PLANS } from "@/modules/billing/plans";

export const metadata: Metadata = { title: "Preços" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Planos</h1>
      <p className="mt-2 text-muted-foreground">Comece grátis e faça upgrade quando crescer. Pagamento via Pix, boleto ou cartão.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {Object.entries(PLANS).map(([key, plan]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <p className="text-3xl font-bold">
                {plan.priceCents === 0 ? "Grátis" : formatCents(plan.priceCents)}
                {plan.priceCents > 0 && <span className="text-sm font-normal text-muted-foreground">/mês</span>}
              </p>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ul className="grid gap-2 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-4 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild>
                <Link href="/registro">Começar</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
