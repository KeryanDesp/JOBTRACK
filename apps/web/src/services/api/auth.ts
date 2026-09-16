import type {
  ActiveSession,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SessionUser,
} from '@jobtrack/shared';
import { apiRequest } from './client';

export const login = (body: LoginInput) =>
  apiRequest<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(body) });

export const register = (body: RegisterInput) =>
  apiRequest<SessionUser>('/auth/register', { method: 'POST', body: JSON.stringify(body) });

export const logout = () => apiRequest<void>('/auth/logout', { method: 'POST' });

export const fetchMe = () => apiRequest<SessionUser>('/auth/me');

export const forgotPassword = (body: ForgotPasswordInput) =>
  apiRequest<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(body) });

export const resetPassword = (body: ResetPasswordInput) =>
  apiRequest<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(body) });

export const fetchSessions = () => apiRequest<ActiveSession[]>('/auth/sessions');

export const revokeSession = (id: string) => apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' });

export const startGoogleLogin = () => apiRequest<{ url: string }>('/auth/google');
