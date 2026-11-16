import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; senha?: string }> }) {
  const { callbackUrl, senha } = await searchParams;
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua empresa.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {senha === "redefinida" && (
          <p role="status" className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
            Senha alterada. Entre com a nova senha.
          </p>
        )}
        <LoginForm callbackUrl={callbackUrl} />
        <div className="flex justify-between text-sm">
          <Link href="/registro" className="text-primary hover:underline">
            Criar conta
          </Link>
          <Link href="/recuperar-senha" className="text-muted-foreground hover:underline">
            Esqueci a senha
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
