/** Rapport de la sonde `GET /health`. Contrat unique, consommé par l'API et le frontend. */
export interface HealthReport {
  status: 'ok' | 'degraded';
  services: { database: 'up' | 'down'; redis: 'up' | 'down' };
  timestamp: string;
}
