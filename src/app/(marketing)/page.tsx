import Link from "next/link";
import { Boxes, FlaskConical, ShoppingCart, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: FlaskConical, title: "Produção", text: "Fórmulas, ordens de produção, lotes e validade. Custo calculado pelos insumos." },
  { icon: Boxes, title: "Estoque", text: "Matéria-prima, embalagens e produto acabado com histórico completo de movimentações." },
  { icon: ShoppingCart, title: "Vendas", text: "Orçamentos e pedidos que baixam o estoque e geram contas a receber automaticamente." },
  { icon: Wallet, title: "Financeiro", text: "Contas a pagar e receber, baixas parciais, estornos e conciliação bancária." },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20">
      <section className="max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight">O ERP feito para fábricas de produtos de limpeza</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Da fórmula ao recebimento: produção, estoque, vendas e financeiro em um só lugar.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg">
            <Link href="/registro">Criar conta grátis</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/precos">Ver planos</Link>
          </Button>
        </div>
      </section>
      <section className="mt-20 grid gap-6 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border p-6">
            <Icon className="size-6 text-primary" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
