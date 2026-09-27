import { CircleCheck } from 'lucide-react';
import type { ArchitectureOptionDTO, ArtifactVersionStatus } from '@/lib/serialize';
import { cn } from '@/lib/utils';

interface ArchitectureOptionsProps {
  options: ArchitectureOptionDTO[];
  status: ArtifactVersionStatus;
  selectedOptionId: string | null;
  approvedOptionId: string | null;
  onSelect: (optionId: string) => void;
}

interface KnownStackFields {
  frontend?: string | undefined;
  backend?: string | undefined;
  database?: string | undefined;
  hosting?: string | undefined;
  repositoryLayout?: string | undefined;
}

function readKnownStack(stack: unknown): KnownStackFields {
  if (typeof stack !== 'object' || stack === null) return {};
  const record = stack as Record<string, unknown>;
  const pick = (key: string) =>
    typeof record[key] === 'string' ? (record[key] as string) : undefined;
  return {
    frontend: pick('frontend'),
    backend: pick('backend'),
    database: pick('database'),
    hosting: pick('hosting'),
    repositoryLayout: pick('repositoryLayout'),
  };
}

interface KnownCandidateDecisionFields {
  decision?: string | undefined;
  drivenBy?: string[] | undefined;
  rationale?: string | undefined;
}

function readKnownCandidateDecision(entry: unknown): KnownCandidateDecisionFields {
  if (typeof entry !== 'object' || entry === null) return {};
  const record = entry as Record<string, unknown>;
  return {
    decision: typeof record.decision === 'string' ? record.decision : undefined,
    drivenBy: Array.isArray(record.drivenBy)
      ? record.drivenBy.filter((value): value is string => typeof value === 'string')
      : undefined,
    rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
  };
}

function readTradeoffs(tradeoffs: unknown[]): string[] {
  return tradeoffs.filter((value): value is string => typeof value === 'string');
}

export function ArchitectureOptions({
  options,
  status,
  selectedOptionId,
  approvedOptionId,
  onSelect,
}: ArchitectureOptionsProps) {
  const displayedOptionId = status === 'draft' ? selectedOptionId : approvedOptionId;

  return (
    <section aria-labelledby="architecture-options-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono-code text-primary text-[11px] font-semibold tracking-wide uppercase">
            Architecture decision
          </p>
          <h2
            id="architecture-options-heading"
            className="text-on-surface mt-1 text-lg font-semibold"
          >
            Compare options
          </h2>
          <p id="architecture-options-description" className="text-on-surface-variant mt-1 text-sm">
            Select one option before approval. Candidate decisions remain proposals while this
            version is a draft.
          </p>
        </div>
        <span className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface-variant rounded-md border px-2 py-1 text-[11px]">
          {options.length} candidates
        </span>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="architecture-options-heading"
        aria-describedby="architecture-options-description"
        className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2"
      >
        {options.map((option) => {
          const stack = readKnownStack(option.stack);
          const stackRows: Array<[string, string | undefined]> = [
            ['Frontend', stack.frontend],
            ['Backend', stack.backend],
            ['Database', stack.database],
            ['Hosting', stack.hosting],
            ['Repository layout', stack.repositoryLayout],
          ];
          const decisions = option.candidateDecisions
            .map(readKnownCandidateDecision)
            .filter((decision) => decision.decision);
          const inputId = `architecture-option-${option.id}`;
          const keyId = `${inputId}-key`;
          const titleId = `${inputId}-title`;
          const isSelected = displayedOptionId === option.id;

          return (
            <label
              key={option.id}
              htmlFor={inputId}
              className={cn(
                'border-surface-dim bg-surface-container-lowest focus-within:ring-primary flex min-w-0 flex-col rounded-lg border transition-colors focus-within:ring-2 focus-within:ring-offset-2',
                status === 'draft' && 'hover:border-outline-variant cursor-pointer',
                status !== 'draft' && 'cursor-default',
                isSelected && 'border-primary bg-primary-fixed/20 ring-primary ring-1',
              )}
            >
              <div className="border-surface-dim flex items-start gap-3 border-b p-4">
                <input
                  type="radio"
                  id={inputId}
                  name="architecture-option"
                  value={option.id}
                  checked={isSelected}
                  onChange={() => onSelect(option.id)}
                  disabled={status !== 'draft'}
                  aria-labelledby={`${keyId} ${titleId}`}
                  className="border-outline-variant text-primary focus-visible:ring-primary mt-1 size-4 shrink-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                />
                <div className="min-w-0 flex-1">
                  <p
                    id={keyId}
                    className="font-mono-code text-on-surface-variant text-[11px] font-medium tracking-wide uppercase"
                  >
                    Option {option.optionKey}
                  </p>
                  <h3
                    id={titleId}
                    className="text-on-surface mt-1 text-base leading-snug font-semibold"
                  >
                    {option.title}
                  </h3>
                </div>
                {isSelected && (
                  <span className="bg-primary-container text-on-primary-container inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium">
                    <CircleCheck className="size-3.5" aria-hidden="true" />
                    {status === 'draft' ? 'Selected' : 'Approved choice'}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-5 p-4">
                <p className="text-on-surface-variant text-sm leading-relaxed">{option.summary}</p>

                {stackRows.some(([, value]) => value) && (
                  <div>
                    <h4 className="font-mono-code text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                      Stack specification
                    </h4>
                    <dl className="mt-2 flex flex-wrap gap-1.5">
                      {stackRows.map(([name, value]) =>
                        value ? (
                          <div
                            key={name}
                            className="border-surface-dim bg-surface-container-low max-w-full rounded-md border px-2.5 py-1.5 text-xs"
                          >
                            <dt className="text-on-surface-variant inline">{name}: </dt>
                            <dd className="text-on-surface inline font-medium break-words">
                              {value}
                            </dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  </div>
                )}

                <div className="border-surface-dim bg-surface-container-low -mx-4 mt-auto -mb-4 rounded-b-lg border-t p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-mono-code text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                      Proposed decisions
                    </h4>
                    <span className="text-on-surface-variant text-xs">
                      {decisions.length} candidates{status === 'draft' && ' · not yet lineage'}
                    </span>
                  </div>
                  {decisions.length > 0 ? (
                    <ul className="mt-3 flex flex-col gap-2">
                      {decisions.map((decision, index) => (
                        <li
                          key={index}
                          className="border-surface-dim bg-surface-container-lowest rounded-md border p-3"
                        >
                          <p className="text-on-surface text-sm leading-snug font-medium">
                            {decision.decision}
                          </p>
                          {decision.rationale && (
                            <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
                              {decision.rationale}
                            </p>
                          )}
                          {decision.drivenBy && decision.drivenBy.length > 0 && (
                            <p className="font-mono-code text-on-surface-variant mt-2 text-[11px]">
                              Driven by {decision.drivenBy.join(', ')}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-on-surface-variant mt-2 text-xs">
                      No candidate decisions supplied.
                    </p>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="border-surface-dim bg-surface-container-lowest rounded-lg border p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-on-surface text-sm font-semibold">Trade-off comparison</h3>
          <p className="text-on-surface-variant text-xs">
            Project-specific assessments from each candidate
          </p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {options.map((option) => {
            const tradeoffs = readTradeoffs(option.tradeoffs);
            return (
              <div
                key={option.id}
                className="border-surface-dim bg-surface-container-low rounded-md border p-4"
              >
                <h4 className="font-mono-code text-on-surface text-xs font-semibold">
                  Option {option.optionKey} · {option.title}
                </h4>
                {tradeoffs.length > 0 ? (
                  <ul className="text-on-surface-variant mt-3 flex list-disc flex-col gap-2 pl-4 text-xs leading-relaxed">
                    {tradeoffs.map((tradeoff, index) => (
                      <li key={index}>{tradeoff}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-on-surface-variant mt-3 text-xs">No trade-offs supplied.</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
