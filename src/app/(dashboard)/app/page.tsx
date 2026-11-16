import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";

/** Pós-login: leva o usuário para a primeira empresa da qual é membro. */
export default async function AppEntryPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { slug: true } } },
  });
  if (!membership) redirect("/registro");
  redirect(`/${membership.organization.slug}/dashboard`);
}
