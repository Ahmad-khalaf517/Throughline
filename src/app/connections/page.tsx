import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getVerifiedUser } from '@/auth';
import { listConnections } from '@/connections';
import { ConnectionsPanel } from '@/components/connections/connections-panel';
import { readConnectionsBanner } from '@/lib/connections-ui';
import { toConnectionDTO, type ConnectionDTO } from '@/lib/serialize';

interface ConnectionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The Connections screen (FR-087, API Contracts 10A): status and identity per
 * provider, never a token. Reads through `connections.listConnections` (pages may
 * import every module) and maps with `toConnectionDTO`, the same mapping
 * `GET /api/connections` uses, so no secret-bearing field can reach the client.
 * `?connected=` / `?error=` come from the OAuth callbacks; only allowlisted
 * values become a banner (`readConnectionsBanner`).
 */
export default async function ConnectionsPage({ searchParams }: ConnectionsPageProps) {
  const user = await getVerifiedUser();
  if (!user) redirect('/sign-in');

  const query = await searchParams;

  let connections: ConnectionDTO[] = [];
  let loadFailed = false;
  try {
    connections = (await listConnections(user.id)).map(toConnectionDTO);
  } catch {
    loadFailed = true;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Link
        href="/projects"
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary w-fit rounded text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        ← All projects
      </Link>

      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h1 className="text-on-surface text-display-sm font-semibold">Connections</h1>
        <p className="text-on-surface-variant mt-1 text-sm">
          Throughline writes to GitHub, Jira and Stitch with your own accounts. Planning never needs
          a connection - only creating things there does.
        </p>
      </header>

      <ConnectionsPanel
        initialConnections={connections}
        loadFailed={loadFailed}
        banner={readConnectionsBanner(query)}
      />
    </main>
  );
}
