import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resetTokenSchema } from "@/modules/account/schemas";
import { getResetTokenStatus } from "@/modules/account/service";
import { ResetPasswordForm } from "../../recuperar-senha/forms";

export const metadata: Metadata = { title: "Nova senha", robots: { index: false } };

const UNAVAILABLE = {
  invalid: "Este link não é válido.",
  expired: "Este link expirou (vale por 1 hora).",
  used: "Este link já foi usado ou foi substituído por um pedido mais recente.",
} as const;

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = resetTokenSchema.safeParse(token);
  const status = parsed.success ? await getResetTokenStatus(parsed.data) : "invalid";

  if (status !== "valid") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Link indisponível</CardTitle>
          <CardDescription>{UNAVAILABLE[status]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/recuperar-senha" className="text-sm text-primary hover:underline">
            Pedir um novo link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Criar nova senha</CardTitle>
        <CardDescription>Ao salvar, você será desconectado de todos os dispositivos.</CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm token={token} />
      </CardContent>
    </Card>
  );
}
