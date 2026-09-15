import { apiRequest } from './client';

export interface HealthReport {
  status: 'ok' | 'degraded';
  services: { database: 'up' | 'down'; redis: 'up' | 'down' };
  timestamp: string;
}

export function fetchHealth(): Promise<HealthReport> {
  return apiRequest<HealthReport>('/health');
}
