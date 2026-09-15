import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Adresse email invalide.');

const strongPassword = z
  .string()
  .min(12, 'Le mot de passe doit contenir au moins 12 caractères.')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères.');

const name = z
  .string()
  .trim()
  .min(1, 'Ce champ est obligatoire.')
  .max(80, 'Ce champ ne peut pas dépasser 80 caractères.');

export const registerSchema = z.object({
  email,
  password: strongPassword,
  firstName: name,
  lastName: name,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Le mot de passe est obligatoire.'),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: strongPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Le mot de passe actuel est obligatoire.'),
  newPassword: strongPassword,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ActiveSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
}
