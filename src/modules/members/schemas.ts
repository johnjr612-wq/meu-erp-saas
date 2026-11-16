import { z } from "zod";

const roleEnum = z.enum(["ADMIN", "FINANCIAL", "OPERATOR"], { message: "Cargo inválido" });

export const createInvitationSchema = z.object({
  email: z.email("E-mail inválido").transform((v) => v.toLowerCase().trim()),
  role: roleEnum,
});

export const invitationIdSchema = z.object({ invitationId: z.string().min(1) });

export const changeRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: roleEnum,
});

export const membershipIdSchema = z.object({ membershipId: z.string().min(1) });

export const inviteTokenSchema = z.string().min(20).max(100);

export const acceptWithSignupSchema = z.object({
  token: inviteTokenSchema,
  name: z.string().trim().min(2, "Informe seu nome"),
  password: z.string().min(8, "Mínimo de 8 caracteres"),
});
