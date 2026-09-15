import type { HealthReport } from '@jobtrack/shared';
import { apiRequest } from './client';

export type { HealthReport };

export function fetchHealth(): Promise<HealthReport> {
  return apiRequest<HealthReport>('/health');
}
