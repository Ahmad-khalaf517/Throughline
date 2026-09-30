import { listConnections } from '@/connections';
import { summarizeIntegrations, type IntegrationsSummary } from '@/lib/connections-ui';

/**
 * Status counts for the header's Integrations link. Only status strings leave
 * this function - `listConnections` never returns a token or ciphertext, and
 * nothing but the status is read from it. A failed read hides the hint rather
 * than failing the whole page.
 */
export async function loadIntegrationsSummary(userId: string): Promise<IntegrationsSummary | null> {
  try {
    const connections = await listConnections(userId);
    return summarizeIntegrations(connections.map((connection) => connection.status));
  } catch {
    return null;
  }
}
