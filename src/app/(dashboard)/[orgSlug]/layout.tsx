import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/lib/session";
import { LABELS } from "@/lib/format";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);

  const allowed = [
    can(ctx.role, "dashboard:read") && "dashboard",
    can(ctx.role, "registry:read") && "cadastros",
    can(ctx.role, "sales:read") && "vendas",
    can(ctx.role, "inventory:read") && "estoque",
    can(ctx.role, "financial:read") && "financeiro",
    (can(ctx.role, "config:members") || can(ctx.role, "billing:manage")) && "config",
  ].filter((v): v is string => typeof v === "string");

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-muted/30 p-4 md:flex">
        <div className="mb-6">
          <p className="truncate font-semibold">{ctx.orgName}</p>
          <p className="text-xs text-muted-foreground">{LABELS.role[ctx.role]}</p>
        </div>
        <SidebarNav orgSlug={ctx.orgSlug} allowed={allowed} />
        <form action={logoutAction} className="mt-auto">
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
            <LogOut /> Sair
          </Button>
        </form>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b p-3 md:hidden">
          <SidebarNav orgSlug={ctx.orgSlug} allowed={allowed} />
        </div>
        <main className="mx-auto grid max-w-6xl gap-6 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
