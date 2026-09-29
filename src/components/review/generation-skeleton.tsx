'use client';

import type { ArtifactType } from '@/lib/serialize';

interface GenerationSkeletonProps {
  artifactType: ArtifactType;
  artifactTypeName: string;
  preview?: string;
}

const SHAPES: Record<ArtifactType, { rows: number; columns: number }> = {
  requirements: { rows: 4, columns: 1 },
  architecture: { rows: 2, columns: 2 },
  ui_requirements: { rows: 4, columns: 1 },
  backlog: { rows: 4, columns: 1 },
};

export function GenerationSkeleton({
  artifactType,
  artifactTypeName,
  preview,
}: GenerationSkeletonProps) {
  const shape = SHAPES[artifactType];
  return (
    <div className="flex flex-col gap-6">
      <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <p role="status" className="text-on-surface text-sm font-medium">
          Generating {artifactTypeName}…
        </p>
        <p className="text-on-surface-variant mt-1 text-xs">
          Draft text appears below as the model responds. The draft is ready after validation and
          saving.
        </p>
        {preview ? (
          <pre
            className="bg-surface-container-low text-on-surface-variant mt-4 max-h-44 overflow-auto rounded-lg p-3 font-mono text-xs break-words whitespace-pre-wrap"
            aria-label="Live generation preview"
            aria-live="off"
          >
            {preview}
          </pre>
        ) : (
          <div
            className="bg-surface-container-low mt-4 h-20 animate-pulse rounded-lg"
            aria-hidden="true"
          />
        )}
      </div>
      {artifactType === 'ui_requirements' && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="border-surface-dim bg-surface-container-lowest rounded-lg border px-4 py-3"
            >
              <div className="bg-surface-container-low h-3 w-24 animate-pulse rounded" />
              <div className="bg-surface-container-low mt-2 h-7 w-10 animate-pulse rounded" />
            </div>
          ))}
        </div>
      )}
      <section
        className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
        aria-hidden="true"
      >
        <div className="bg-surface-container-low h-5 w-44 animate-pulse rounded" />
        <div className={`mt-5 grid gap-4 ${shape.columns === 2 ? 'lg:grid-cols-2' : ''}`}>
          {Array.from({ length: shape.rows }, (_, index) => (
            <div
              key={index}
              className={`border-surface-dim rounded-lg border p-4 ${artifactType === 'backlog' && index > 0 ? 'sm:ml-6' : ''}`}
            >
              <div className="flex items-center gap-2">
                <div className="bg-surface-container-low h-4 w-14 animate-pulse rounded" />
                <div className="bg-surface-container-low h-3 w-24 animate-pulse rounded" />
              </div>
              <div className="bg-surface-container-low mt-4 h-4 w-4/5 animate-pulse rounded" />
              <div className="bg-surface-container-low mt-2 h-3 w-3/5 animate-pulse rounded" />
              {(artifactType === 'backlog' || artifactType === 'architecture') && (
                <div className="bg-surface-container-low mt-4 h-3 w-2/5 animate-pulse rounded" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
