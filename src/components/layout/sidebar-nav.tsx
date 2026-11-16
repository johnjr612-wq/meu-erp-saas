"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LayoutDashboard, Settings, ShoppingCart, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "cadastros", label: "Cadastros", icon: Users },
  { href: "vendas", label: "Vendas", icon: ShoppingCart },
  { href: "estoque", label: "Estoque e Produção", icon: Boxes },
  { href: "financeiro", label: "Financeiro", icon: Wallet },
  { href: "config", label: "Configurações", icon: Settings },
] as const;

/** Recebe a lista de seções permitidas (calculada no servidor via RBAC). */
export function SidebarNav({ orgSlug, allowed }: { orgSlug: string; allowed: string[] }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-1">
      {ITEMS.filter((i) => allowed.includes(i.href)).map(({ href, label, icon: Icon }) => {
        const url = `/${orgSlug}/${href}`;
        const active = pathname.startsWith(url);
        return (
          <Link
            key={href}
            href={url}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
