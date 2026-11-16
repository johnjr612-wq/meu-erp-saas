import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Recuperar senha" };

// TODO: implementar envio de token por e-mail (ex.: Resend) + tabela PasswordResetToken.
export default function RecoverPasswordPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>
          A recuperação por e-mail ainda não está disponível. Peça ao proprietário da empresa para redefinir seu acesso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Voltar ao login
        </Link>
      </CardContent>
    </Card>
  );
}
