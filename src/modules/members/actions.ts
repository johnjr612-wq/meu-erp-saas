"use server";

import { createAction } from "@/lib/action";
import { resolveBaseUrl } from "@/lib/url";
import { changeRoleSchema, createInvitationSchema, invitationIdSchema, membershipIdSchema } from "./schemas";
import { changeMemberRole, createInvitation, removeMember, revokeInvitation } from "./service";

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
