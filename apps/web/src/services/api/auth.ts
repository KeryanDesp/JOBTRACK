import type {
  ActiveSession,
  ChangePasswordFormInput,
  ForgotPasswordFormInput,
  LoginFormInput,
  RegisterFormInput,
  ResetPasswordFormInput,
  SessionUser,
} from '@jobtrack/shared';
import { apiRequest } from './client';

// Corps de requête typés avec le type d'entrée Zod (`*FormInput` : « ce que le
// formulaire envoie »), pas le type de sortie (« ce que l'API renvoie ») —
// identiques ici en pratique, mais l'appelant doit pouvoir passer ce qu'un
// formulaire produit avant validation, pas après.
export const login = (body: LoginFormInput) =>
  apiRequest<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const register = (body: RegisterFormInput) =>
  apiRequest<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const logout = () => apiRequest<void>('/auth/logout', { method: 'POST' });

export const fetchMe = () => apiRequest<SessionUser>('/auth/me');

export const forgotPassword = (body: ForgotPasswordFormInput) =>
  apiRequest<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) });

export const resetPassword = (body: ResetPasswordFormInput) =>
  apiRequest<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) });

export const changePassword = (body: ChangePasswordFormInput) =>
  apiRequest<void>('/auth/password', { method: 'PATCH', body: JSON.stringify(body) });

export const fetchSessions = () => apiRequest<ActiveSession[]>('/auth/sessions');

export const revokeSession = (id: string) => apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' });

export const startGoogleLogin = () => apiRequest<{ url: string }>('/auth/google');

export const completeOnboarding = () => apiRequest<void>('/onboarding/complete', { method: 'POST' });
