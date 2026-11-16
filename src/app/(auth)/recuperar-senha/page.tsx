import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestResetForm } from "./forms";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function RecoverPasswordPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>Informe o e-mail da sua conta para receber um link de redefinição.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <RequestResetForm />
        <Link href="/login" className="text-sm text-primary hover:underline">
          Voltar ao login
        </Link>
      </CardContent>
    </Card>
  );
}
