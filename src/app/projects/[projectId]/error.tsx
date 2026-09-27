'use client';

export default function ProjectError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="bg-surface-container-lowest border-surface-dim rounded-lg border p-6">
        <h1 className="text-on-surface text-xl font-semibold">Project overview unavailable</h1>
        <p className="text-on-surface-variant mt-2 text-sm">
          The project data could not be loaded.
        </p>
        <button
          type="button"
          onClick={reset}
          className="bg-primary-container focus-visible:ring-primary mt-4 rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:ring-2 focus-visible:outline-none"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
