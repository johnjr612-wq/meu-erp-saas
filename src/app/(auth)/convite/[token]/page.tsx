import Link from "next/link";
import type { Metadata } from "next";
import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { formatDate, LABELS } from "@/lib/format";
import { getSessionUserId } from "@/lib/session";
import { inviteTokenSchema } from "@/modules/members/schemas";
import { getInvitationByToken } from "@/modules/members/service";
import { AcceptInviteForm, SignupInviteForm } from "../invite-forms";

export const metadata: Metadata = { title: "Convite", robots: { index: false } };

const UNAVAILABLE = {
  invalid: "Este link de convite não é válido.",
  expired: "Este convite expirou. Peça um novo convite a quem enviou.",
  revoked: "Este convite foi cancelado. Peça um novo convite a quem enviou.",
  accepted: "Este convite já foi utilizado.",
} as const;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsedToken = inviteTokenSchema.safeParse(token);
  const invitation = parsedToken.success ? await getInvitationByToken(parsedToken.data) : ({ status: "invalid" } as const);

  if (invitation.status !== "valid") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Convite indisponível</CardTitle>
          <CardDescription>{UNAVAILABLE[invitation.status]}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm text-primary hover:underline">
            Ir para o login
          </Link>
        </CardContent>
      </Card>
    );
  }

  const userId = await getSessionUserId();
  const sessionUser = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    : null;
  const accountExists =
    !sessionUser && !!(await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } }));

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Convite para {invitation.orgName}</CardTitle>
        <CardDescription>
          Você foi convidado(a) como <strong>{LABELS.role[invitation.role]}</strong>. Válido até{" "}
          {formatDate(invitation.expiresAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sessionUser && sessionUser.email === invitation.email && <AcceptInviteForm token={token} />}

        {sessionUser && sessionUser.email !== invitation.email && (
          <div className="grid gap-3 text-sm">
            <p>
              Este convite é para <strong>{invitation.email}</strong>, mas você está conectado como{" "}
              <strong>{sessionUser.email}</strong>.
            </p>
            <form action={logoutAction}>
              <input type="hidden" name="next" value={`/convite/${token}`} />
              <Button variant="outline" size="sm">
                Sair e entrar com outra conta
              </Button>
            </form>
          </div>
        )}

        {!sessionUser && accountExists && (
          <div className="grid gap-3 text-sm">
            <p>
              Já existe uma conta para <strong>{invitation.email}</strong>. Entre para aceitar o convite.
            </p>
            <Button asChild>
              <Link href={`/login?callbackUrl=${encodeURIComponent(`/convite/${token}`)}`}>Entrar e aceitar</Link>
            </Button>
          </div>
        )}

        {!sessionUser && !accountExists && <SignupInviteForm token={token} email={invitation.email} />}
      </CardContent>
    </Card>
  );
}
