'use client';

import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { ArtifactType, ArtifactVersionDTO, QualityIssueDTO } from '@/lib/serialize';
import { ArtifactReviewScreen } from './artifact-review-screen';
import { GenerationSkeleton } from './generation-skeleton';

const STALE_REASON_COPY: Record<string, string> = {
  base_changed: 'The current draft changed while this was generating.',
  dependency_superseded: 'A prerequisite artifact was re-approved while this was generating.',
};

type PanelState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'error'; message: string }
  | { kind: 'stale'; reason: string };

interface ArtifactGenerationPanelProps {
  projectId: string;
  type: ArtifactType;
  artifactTypeName: string;
  initialVersion: ArtifactVersionDTO | null;
  initialQualityIssues: QualityIssueDTO[];
  missingPrerequisiteNames: string[];
}

/**
 * Client wrapper around `ArtifactReviewScreen` that owns the real
 * `POST .../artifacts/:type/generate` call: a "Generate" CTA when this
 * artifact type has no version yet, the progressive skeleton while that call
 * is in flight, and the resulting version handed to the review screen once it
 * resolves. Approve/edit inside `ArtifactReviewScreen` are unchanged - still
 * local-only simulation, not wired to the real approve/edit routes.
 */
export function ArtifactGenerationPanel({
  projectId,
  type,
  artifactTypeName,
  initialVersion,
  initialQualityIssues,
  missingPrerequisiteNames,
}: ArtifactGenerationPanelProps) {
  const [version, setVersion] = useState(initialVersion);
  const [qualityIssues, setQualityIssues] = useState(initialQualityIssues);
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  async function handleGenerate() {
    setState({ kind: 'generating' });
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${type}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      if (!response.ok) {
        setState({ kind: 'error', message: body?.error?.message ?? 'Generation failed.' });
        return;
      }

      if (body.status === 'stale') {
        // The recorded version here is a rejected `stale_generation_context`
        // row (ERD 3.3 step 7), not a usable draft - never hand it to the
        // review screen. Keep whatever was already showing and let the
        // reader retry.
        setState({ kind: 'stale', reason: body.reason ?? 'base_changed' });
        return;
      }

      const nextVersion: ArtifactVersionDTO = body.version;
      setVersion(nextVersion);

      const qualityGateResponse = await fetch(
        `/api/artifact-versions/${nextVersion.id}/quality-gate`,
      );
      const qualityGateBody = qualityGateResponse.ok ? await qualityGateResponse.json() : null;
      setQualityIssues(qualityGateBody?.issues ?? []);
      setState({ kind: 'idle' });
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Try again.' });
    }
  }

  if (state.kind === 'generating') {
    return <GenerationSkeleton artifactTypeName={artifactTypeName} />;
  }

  if (!version) {
    const blocked = missingPrerequisiteNames.length > 0;
    return (
      <div className="border-surface-dim bg-surface-container-lowest flex flex-col items-center gap-4 rounded-xl border p-8 text-center">
        <p className="text-on-surface text-sm font-medium">
          {artifactTypeName} hasn&apos;t been generated yet.
        </p>
        <p className="text-on-surface-variant max-w-sm text-sm">
          {blocked
            ? `Approve ${missingPrerequisiteNames.join(', ')} before generating ${artifactTypeName}.`
            : `Generate a first draft from the project brief and its approved prerequisites.`}
        </p>
        {state.kind === 'error' && (
          <p className="text-status-rejected flex items-center gap-1.5 text-xs">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {state.message}
          </p>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={blocked}
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          Generate {artifactTypeName}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {state.kind === 'stale' && (
        <div className="border-status-draft-border bg-status-draft-bg text-status-draft-text flex items-start gap-2 rounded-lg border border-dashed p-4 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {STALE_REASON_COPY[state.reason] ?? 'The generation context changed mid-run.'}{' '}
            <button
              type="button"
              onClick={handleGenerate}
              className="font-medium underline underline-offset-2"
            >
              Generate again
            </button>{' '}
            to pick up the latest state.
          </p>
        </div>
      )}
      {state.kind === 'error' && (
        <p className="text-status-rejected flex items-center gap-1.5 text-sm">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      )}
      <ArtifactReviewScreen
        artifactTypeName={artifactTypeName}
        version={version}
        qualityIssues={qualityIssues}
      />
    </div>
  );
}
