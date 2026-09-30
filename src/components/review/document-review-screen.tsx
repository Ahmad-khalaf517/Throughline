'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleAlert, Download, FileText, Loader2 } from 'lucide-react';
import type { ArtifactVersionDTO, ArtifactVersionStatus } from '@/lib/serialize';
import { StatusBadge } from '@/components/status/status-badge';

type DocumentType = 'brd' | 'erd';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function labelFor(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function renderValue(value: unknown) {
  if (typeof value === 'string') return <p className="whitespace-pre-wrap">{value}</p>;
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'string')) {
      return (
        <ul className="list-disc space-y-1 pl-5">
          {value.map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-3">
        {value.map((entry, index) => (
          <pre
            key={index}
            className="bg-surface-container-low overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap"
          >
            {JSON.stringify(entry, null, 2)}
          </pre>
        ))}
      </div>
    );
  }
  return (
    <pre className="bg-surface-container-low overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

async function readResponse(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) {
    const record = asRecord(body);
    const error = asRecord(record.error);
    throw new Error(typeof error.message === 'string' ? error.message : 'The request failed.');
  }
  return asRecord(body);
}

export function DocumentReviewScreen({
  projectId,
  type,
  title,
  version,
  history,
}: {
  projectId: string;
  type: DocumentType;
  title: string;
  version: ArtifactVersionDTO | null;
  history: { id: string; versionNumber: number; status: ArtifactVersionStatus }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'generate' | 'approve' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const payload = asRecord(version?.payload);

  async function generate() {
    setPending('generate');
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${type}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback.trim() ? { feedback: feedback.trim() } : {}),
      });
      const result = await readResponse(response);
      if (result.status === 'stale')
        throw new Error('A source changed during generation. Generate again.');
      setFeedback('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Generation failed.');
    } finally {
      setPending(null);
    }
  }

  async function approve() {
    if (!version) return;
    setPending('approve');
    setError(null);
    try {
      await readResponse(
        await fetch(`/api/artifact-versions/${version.id}/approve`, { method: 'POST' }),
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Approval failed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="document-print-root space-y-6">
      <header className="app-card p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono-code text-primary text-xs font-semibold uppercase">
              Generated document
            </p>
            <h1 className="app-display text-on-surface mt-2 text-3xl">{title}</h1>
            <p className="text-on-surface-variant mt-2 text-sm">
              {type === 'brd'
                ? 'Derived from approved Requirements.'
                : 'Derived from approved Requirements and Architecture.'}
            </p>
          </div>
          {version && <StatusBadge status={version.status} />}
        </div>
        {version?.sourceCurrent === false && (
          <p
            role="status"
            className="bg-error-container text-on-error-container mt-4 flex items-start gap-2 rounded-lg p-3 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            An approved source has changed. Regenerate this document before approval or use.
          </p>
        )}
        {version?.sourceCurrent === true && (
          <p className="text-on-surface-variant mt-4 text-sm">Source versions are current.</p>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="bg-error-container text-on-error-container document-print-hide rounded-lg p-3 text-sm"
        >
          {error}
        </p>
      )}

      <section className="app-card document-print-hide space-y-4 p-6" aria-label="Document actions">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void generate()}
            className="bg-primary-container text-on-primary-container focus-visible:ring-primary inline-flex min-h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium focus-visible:ring-2 disabled:opacity-60"
          >
            {pending === 'generate' && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            {pending === 'generate'
              ? 'Generating…'
              : version
                ? 'Regenerate document'
                : 'Generate document'}
          </button>
          {version?.status === 'draft' && (
            <button
              type="button"
              disabled={pending !== null || version.sourceCurrent === false}
              onClick={() => void approve()}
              className="border-surface-dim text-on-surface focus-visible:ring-primary inline-flex min-h-11 items-center rounded-lg border px-5 text-sm font-medium focus-visible:ring-2 disabled:opacity-60"
            >
              {pending === 'approve' ? 'Approving…' : 'Approve draft'}
            </button>
          )}
          {version?.status === 'approved' && version.sourceCurrent !== false && (
            <button
              type="button"
              onClick={() => window.print()}
              className="border-surface-dim text-on-surface focus-visible:ring-primary inline-flex min-h-11 items-center gap-2 rounded-lg border px-5 text-sm font-medium focus-visible:ring-2"
            >
              <Download className="size-4" aria-hidden="true" />
              Export PDF
            </button>
          )}
        </div>
        {version?.status === 'approved' && version.sourceCurrent !== false && (
          <p className="text-on-surface-variant text-xs">Choose Save as PDF in the print dialog.</p>
        )}
        <label htmlFor="document-feedback" className="text-on-surface text-sm font-medium">
          Guidance for regeneration (optional)
        </label>
        <textarea
          id="document-feedback"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          className="border-surface-dim bg-surface-container-lowest text-on-surface focus-visible:ring-primary w-full rounded-lg border p-3 text-sm focus-visible:ring-2"
          placeholder="Describe what the next draft should change."
        />
      </section>

      {history.length > 0 && (
        <section className="app-card document-print-hide p-6" aria-label="Version history">
          <h2 className="text-on-surface text-base font-semibold">Version history</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {history.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/projects/${projectId}/versions/${entry.id}`}
                  className="border-surface-dim text-primary focus-visible:ring-primary inline-flex rounded-md border px-3 py-2 text-sm focus-visible:ring-2"
                >
                  Version {entry.versionNumber} · {entry.status}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {version ? (
        <section className="space-y-4" aria-label="Document content">
          <div className="flex items-center gap-2">
            <FileText className="text-primary size-5" aria-hidden="true" />
            <h2 className="text-on-surface text-lg font-semibold">
              Version {version.versionNumber}
            </h2>
          </div>
          {Object.entries(payload).map(([key, value]) => (
            <section key={key} className="app-card p-6">
              <h3 className="text-on-surface mb-3 text-base font-semibold">{labelFor(key)}</h3>
              <div className="text-on-surface-variant text-sm leading-relaxed">
                {renderValue(value)}
              </div>
            </section>
          ))}
        </section>
      ) : (
        <p className="border-surface-dim bg-surface-container-lowest text-on-surface-variant rounded-xl border p-8 text-center text-sm">
          No {type.toUpperCase()} version has been generated yet.
        </p>
      )}
    </div>
  );
}
