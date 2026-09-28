import { Fragment } from 'react';
import { SquarePen } from 'lucide-react';
import type { ArtifactVersionStatus, ItemVersionDTO } from '@/lib/serialize';
import { FlaggedGlyph } from '@/components/status/status-badge';

interface UiRequirementsReviewLayoutProps {
  items: ItemVersionDTO[];
  status: ArtifactVersionStatus;
  onEdit: (item: ItemVersionDTO) => void;
}

interface UiRequirementFields {
  title?: string | undefined;
  description?: string | undefined;
  behavior?: string | undefined;
  targetUsers?: string[] | undefined;
  screens?: string[] | undefined;
  sourceRefs?: string[] | undefined;
  navigationExpectations?: string | undefined;
  responsiveConstraints?: string | undefined;
  accessibilityConstraints?: string | undefined;
  uxPriorities?: string[] | undefined;
}

function readFields(payload: unknown): UiRequirementFields {
  if (typeof payload !== 'object' || payload === null) return {};
  const record = payload as Record<string, unknown>;
  const strings = (key: string) =>
    Array.isArray(record[key])
      ? record[key].filter((entry: unknown): entry is string => typeof entry === 'string')
      : undefined;
  const string = (key: string) =>
    typeof record[key] === 'string' ? (record[key] as string) : undefined;

  return {
    title: string('title'),
    description: string('description'),
    behavior: string('behavior'),
    targetUsers: strings('targetUsers'),
    screens: strings('screens'),
    sourceRefs: strings('sourceRefs'),
    navigationExpectations: string('navigationExpectations'),
    responsiveConstraints: string('responsiveConstraints'),
    accessibilityConstraints: string('accessibilityConstraints'),
    uxPriorities: strings('uxPriorities'),
  };
}

export function UiRequirementsReviewLayout({
  items,
  status,
  onEdit,
}: UiRequirementsReviewLayoutProps) {
  const fieldsByItem = items.map((item) => readFields(item.payload));
  const targetUsers = new Set(fieldsByItem.flatMap((fields) => fields.targetUsers ?? []));
  const screens = new Set(fieldsByItem.flatMap((fields) => fields.screens ?? []));
  const sourceRefs = new Set(fieldsByItem.flatMap((fields) => fields.sourceRefs ?? []));

  return (
    <>
      <section
        aria-label="UI requirements summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          ['Specifications', items.length],
          ['Target users', targetUsers.size],
          ['Named screens', screens.size],
          ['Recorded source refs', sourceRefs.size],
        ].map(([label, count]) => (
          <div
            key={label}
            className="border-surface-dim bg-surface-container-lowest rounded-lg border px-4 py-3"
          >
            <p className="text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
              {label}
            </p>
            <p className="text-on-surface mt-1 text-2xl font-semibold tabular-nums">{count}</p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="items-heading"
        className="border-surface-dim bg-surface-container-lowest overflow-hidden rounded-xl border"
      >
        <div className="bg-surface-container-low border-surface-dim flex flex-wrap items-center gap-2 border-b px-5 py-4">
          <h2 id="items-heading" className="text-on-surface text-lg font-semibold">
            Interface Contract Ledger
          </h2>
          <span className="font-mono-code bg-surface-container-high text-on-surface-variant rounded-full px-2 py-0.5 text-[11px]">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-on-surface-variant px-5 py-6 text-sm">
            This version has no items yet.
          </p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                <tr className="border-surface-dim border-b">
                  <th scope="col" className="w-24 px-5 py-3">
                    Item ID
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Screen / behavior description
                  </th>
                  <th scope="col" className="w-36 px-4 py-3">
                    Sourced from
                  </th>
                  <th scope="col" className="w-44 px-4 py-3">
                    Target surface
                  </th>
                  <th scope="col" className="w-20 px-5 py-3 text-right">
                    Edit
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const fields = readFields(item.payload);
                  return (
                    <Fragment key={item.itemVersionId}>
                      <tr className="border-surface-dim hover:bg-surface-container-low/50 border-b align-top transition-colors">
                        <th scope="row" className="px-5 py-4 font-normal">
                          <span className="font-mono-code bg-surface-container-low text-on-surface rounded px-2 py-1 text-xs font-semibold">
                            {item.displayKey}
                          </span>
                        </th>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-on-surface font-semibold">
                              {fields.title ?? fields.behavior ?? 'UI requirement'}
                            </span>
                            {item.impact ? (
                              item.impact.acknowledged ? (
                                <span className="text-on-surface-variant text-xs">
                                  Acknowledged
                                </span>
                              ) : (
                                <FlaggedGlyph title={`${item.displayKey} is flagged`} />
                              )
                            ) : (
                              <span className="text-on-surface-variant text-xs">No impact</span>
                            )}
                          </div>
                          {fields.description && (
                            <p className="text-on-surface-variant mt-1 max-w-2xl leading-relaxed">
                              {fields.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {fields.sourceRefs?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {fields.sourceRefs.map((ref) => (
                                <span
                                  key={ref}
                                  className="font-mono-code bg-surface-container-high text-on-surface rounded px-1.5 py-0.5 text-xs"
                                >
                                  {ref}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-on-surface-variant text-xs">None recorded</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {fields.screens?.length ? (
                            <ul className="flex flex-wrap gap-1">
                              {fields.screens.map((screen) => (
                                <li
                                  key={screen}
                                  className="bg-surface-container-high text-on-surface rounded px-2 py-1 text-xs"
                                >
                                  {screen}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-on-surface-variant text-xs">None recorded</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            disabled={status !== 'draft'}
                            title={
                              status === 'draft'
                                ? `Edit ${item.displayKey}`
                                : 'Editing is only available while this version is a draft (ERD 5.3).'
                            }
                            aria-label={`Edit ${item.displayKey}`}
                            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary inline-flex size-8 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <SquarePen className="size-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                      <tr className="border-surface-dim border-b last:border-b-0">
                        <td colSpan={5} className="px-5 pb-4">
                          <details className="text-sm">
                            <summary className="text-primary focus-visible:ring-primary w-fit cursor-pointer rounded text-xs font-medium focus-visible:ring-2 focus-visible:outline-none">
                              Specification details for {item.displayKey}
                            </summary>
                            <dl className="bg-surface-container-low mt-3 grid gap-3 rounded-lg p-4 sm:grid-cols-2">
                              {[
                                ['Target users', fields.targetUsers?.join(', ')],
                                ['Navigation', fields.navigationExpectations],
                                ['Responsive', fields.responsiveConstraints],
                                ['Accessibility', fields.accessibilityConstraints],
                                ['UX priorities', fields.uxPriorities?.join('; ')],
                                ['Behavior', fields.behavior],
                              ].map(([label, value]) =>
                                value ? (
                                  <div key={label}>
                                    <dt className="text-on-surface-variant text-xs font-semibold">
                                      {label}
                                    </dt>
                                    <dd className="text-on-surface mt-0.5 leading-relaxed">
                                      {value}
                                    </dd>
                                  </div>
                                ) : null,
                              )}
                            </dl>
                          </details>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
