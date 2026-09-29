type PageKind = 'projects' | 'overview' | 'review' | 'list' | 'outputs' | 'detail';

function Bar({ width = 'w-2/3', height = 'h-4' }: { width?: string; height?: string }) {
  return <div className={`bg-surface-container-low animate-pulse rounded ${width} ${height}`} />;
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-surface-dim bg-surface-container-lowest rounded-lg border p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function PageSkeleton({ kind }: { kind: PageKind }) {
  if (kind === 'projects')
    return (
      <main
        className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-9 px-4 py-10 sm:px-6 lg:px-8 lg:py-14"
        role="status"
        aria-label="Loading projects"
      >
        <div className="flex items-start justify-between gap-4" aria-hidden="true">
          <div className="w-2/3 space-y-3">
            <Bar width="w-28" height="h-3" />
            <Bar width="w-56" height="h-12" />
            <Bar width="w-4/5" height="h-4" />
          </div>
          <Bar width="w-32" height="h-11" />
        </div>
        <section aria-hidden="true">
          <div className="border-surface-dim mb-4 flex justify-between border-b pb-3">
            <Bar width="w-24" height="h-3" />
            <Bar width="w-36" height="h-3" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Panel key={i} className="flex min-h-48 flex-col p-6">
                <Bar width="w-10" height="h-10" />
                <div className="mt-5">
                  <Bar width="w-2/5" height="h-5" />
                </div>
                <div className="mt-2">
                  <Bar width="w-4/5" height="h-4" />
                </div>
                <div className="mt-auto pt-5">
                  <Bar width="w-28" height="h-3" />
                </div>
              </Panel>
            ))}
          </div>
        </section>
      </main>
    );

  if (kind === 'overview')
    return (
      <main
        className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
        role="status"
        aria-label="Loading project overview"
      >
        <div className="space-y-3 pb-1" aria-hidden="true">
          <Bar width="w-40" height="h-3" />
          <Bar width="w-80" height="h-12" />
          <Bar width="w-3/5" />
        </div>
        <Panel className="p-7" aria-hidden="true">
          <Bar width="w-36" height="h-3" />
          <div className="mt-3">
            <Bar width="w-56" height="h-8" />
          </div>
          <div className="mt-6">
            <Bar width="w-full" height="h-2" />
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Panel key={i} className="flex min-h-32 flex-col justify-between p-4">
                <Bar width="w-5" height="h-5" />
                <Bar width="w-3/4" />
                <Bar width="w-1/2" height="h-3" />
              </Panel>
            ))}
          </div>
        </Panel>
        <div className="space-y-2" aria-hidden="true">
          <Bar width="w-24" height="h-3" />
          <Bar width="w-32" height="h-6" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className="flex min-h-48 flex-col justify-between">
              <Bar width="w-9" height="h-9" />
              <div className="space-y-2">
                <Bar width="w-3/4" />
                <Bar width="w-1/2" height="h-8" />
              </div>
              <Bar width="w-2/3" height="h-3" />
            </Panel>
          ))}
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-12" aria-hidden="true">
          <Panel className="lg:col-span-8">
            <Bar width="w-40" height="h-5" />
            <div className="mt-6 space-y-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Bar width="w-3/5" />
                  <Bar width="w-4/5" height="h-3" />
                </div>
              ))}
            </div>
          </Panel>
          <div className="space-y-6 lg:col-span-4">
            <Panel>
              <Bar width="w-36" height="h-5" />
              <div className="mt-5">
                <Bar width="w-4/5" />
              </div>
            </Panel>
            <Panel>
              <Bar width="w-28" height="h-5" />
              <div className="mt-5 space-y-2">
                <Bar width="w-full" />
                <Bar width="w-3/4" />
              </div>
            </Panel>
          </div>
        </div>
      </main>
    );

  const width = kind === 'list' || kind === 'outputs' ? 'max-w-6xl' : 'max-w-5xl';
  return (
    <main
      className={`mx-auto flex min-h-screen w-full ${width} flex-col gap-6 px-4 py-8 sm:px-6`}
      role="status"
      aria-label="Loading project page"
    >
      <div className="space-y-3" aria-hidden="true">
        <Bar width="w-24" height="h-3" />
        <Bar width="w-48" height="h-8" />
        <Bar width="w-3/5" height="h-4" />
      </div>
      {kind === 'outputs' ? (
        <div className="grid gap-5 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Panel key={i} className="h-44 space-y-4">
              <Bar width="w-1/3" height="h-5" />
              <Bar width="w-full" />
              <Bar width="w-3/4" />
            </Panel>
          ))}
        </div>
      ) : null}
      {kind === 'review' ? (
        <Panel className="space-y-3" aria-hidden="true">
          <Bar width="w-2/5" height="h-6" />
          <Bar width="w-3/4" />
          <Bar width="w-1/3" height="h-3" />
        </Panel>
      ) : null}
      {kind !== 'outputs' && (
        <Panel className="space-y-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-surface-dim space-y-2 border-b pb-4 last:border-0 last:pb-0"
            >
              <Bar width="w-2/5" />
              <Bar width="w-4/5" height="h-3" />
            </div>
          ))}
        </Panel>
      )}
    </main>
  );
}
