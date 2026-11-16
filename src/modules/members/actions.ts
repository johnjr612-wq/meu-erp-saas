"use server";

import { headers } from "next/headers";
import { createAction } from "@/lib/action";
import { changeRoleSchema, createInvitationSchema, invitationIdSchema, membershipIdSchema } from "./schemas";
import { changeMemberRole, createInvitation, removeMember, revokeInvitation } from "./service";

/** URL base para o link do convite: APP_URL ou o host da própria requisição. */
async function resolveBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const createInvitationAction = createAction({
  schema: createInvitationSchema,
  permission: "config:members",
  revalidate: "/config",
  handler: async ({ ctx, db, input }) =>
    createInvitation(db, ctx, { ...input, baseUrl: await resolveBaseUrl() }),
});

export const revokeInvitationAction = createAction({
  schema: invitationIdSchema,
  permission: "config:members",
  revalidate: "/config",
  successMessage: "Convite revogado.",
  handler: ({ ctx, db, input }) => revokeInvitation(db, ctx, input.invitationId),
});

export const changeMemberRoleAction = createAction({
  schema: changeRoleSchema,
  permission: "config:members",
  revalidate: "/config",
  successMessage: "Cargo alterado.",
  handler: ({ ctx, input }) => changeMemberRole(ctx, input.membershipId, input.role),
});

export const removeMemberAction = createAction({
  schema: membershipIdSchema,
  permission: "config:members",
  revalidate: "/config",
  successMessage: "Membro removido.",
  handler: ({ ctx, input }) => removeMember(ctx, input.membershipId),
});
