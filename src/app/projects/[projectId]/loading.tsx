export default function ProjectLoading() {
  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading project overview"
    >
      <p className="text-on-surface-variant text-sm">Loading project overview…</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((tile) => (
          <div
            key={tile}
            className="bg-surface-container-low border-surface-dim h-32 animate-pulse rounded-lg border"
          />
        ))}
      </div>
    </main>
  );
}
