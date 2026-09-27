import { CircleAlert, CircleCheck, Link2, SquarePen } from 'lucide-react';
import type { ArtifactVersionStatus, ItemVersionDTO, QualityIssueDTO } from '@/lib/serialize';
import { FlaggedGlyph } from '@/components/status/status-badge';

interface BacklogReviewLayoutProps {
  items: ItemVersionDTO[];
  qualityIssues: QualityIssueDTO[];
  status: ArtifactVersionStatus;
  onEdit: (item: ItemVersionDTO) => void;
}

interface BacklogFields {
  title?: string | undefined;
  description?: string | undefined;
  priority?: string | undefined;
  sourceRefs: string[];
  acceptanceCriteria: string[];
}

function readFields(payload: unknown): BacklogFields {
  if (typeof payload !== 'object' || payload === null) {
    return { sourceRefs: [], acceptanceCriteria: [] };
  }
  const record = payload as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    priority: typeof record.priority === 'string' ? record.priority : undefined,
    sourceRefs: Array.isArray(record.sourceRefs)
      ? record.sourceRefs.filter((value): value is string => typeof value === 'string')
      : [],
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function BacklogItem({
  item,
  status,
  onEdit,
}: {
  item: ItemVersionDTO;
  status: ArtifactVersionStatus;
  onEdit: (item: ItemVersionDTO) => void;
}) {
  const fields = readFields(item.payload);
  return (
    <li className="border-surface-dim bg-surface-container-lowest hover:border-outline-variant rounded-lg border p-4 shadow-sm transition-colors">
      <div className="flex flex-wrap items-start gap-2">
        <span className="font-mono-code bg-surface-container-low text-on-surface rounded px-2 py-0.5 text-xs font-semibold">
          {item.displayKey}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-on-surface text-sm leading-snug font-semibold">
            {fields.title ?? `${item.itemType === 'epic' ? 'Epic' : 'Story'} ${item.displayKey}`}
          </h3>
          {fields.description && (
            <p className="text-on-surface-variant mt-2 text-sm leading-relaxed">
              {fields.description}
            </p>
          )}
        </div>
        {item.impact && !item.impact.acknowledged && (
          <FlaggedGlyph title={`${item.displayKey} is flagged`} />
        )}
        {item.impact?.acknowledged && (
          <span className="text-on-surface-variant text-xs">Impact acknowledged</span>
        )}
        <button
          type="button"
          onClick={() => onEdit(item)}
          disabled={status !== 'draft'}
          title={
            status === 'draft'
              ? `Edit ${item.displayKey}`
              : 'Editing is only available while this version is a draft (ERD 5.3).'
          }
          className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Edit ${item.displayKey}`}
        >
          <SquarePen className="size-4" aria-hidden="true" />
        </button>
      </div>
      {(fields.priority || fields.sourceRefs.length > 0) && (
        <div className="text-on-surface-variant mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {fields.priority && <span>Priority: {fields.priority}</span>}
          {fields.sourceRefs.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="size-3.5" aria-hidden="true" />
              Source refs: {fields.sourceRefs.join(', ')}
            </span>
          )}
        </div>
      )}
      {item.itemType === 'story' && fields.acceptanceCriteria.length > 0 && (
        <div className="border-surface-dim mt-3 border-t pt-3">
          <p className="text-on-surface-variant text-xs font-medium">Acceptance criteria</p>
          <ul className="text-on-surface-variant mt-1 list-disc space-y-1 pl-5 text-xs leading-relaxed">
            {fields.acceptanceCriteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function BacklogReviewLayout({
  items,
  qualityIssues,
  status,
  onEdit,
}: BacklogReviewLayoutProps) {
  const epics = items.filter((item) => item.itemType === 'epic');
  const stories = items.filter((item) => item.itemType === 'story');
  const epicIds = new Set(epics.map((item) => item.logicalItemId));
  const ungrouped = items.filter(
    (item) =>
      item.itemType !== 'epic' &&
      (item.itemType !== 'story' ||
        !item.parentLogicalItemId ||
        !epicIds.has(item.parentLogicalItemId)),
  );
  const flaggedItems = items.filter((item) => item.impact !== null);
  const storiesWithRefs = stories.filter((item) => readFields(item.payload).sourceRefs.length > 0);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <section
        aria-labelledby="work-breakdown-heading"
        className="border-surface-dim bg-surface-container-lowest rounded-lg border p-4 shadow-sm sm:p-6 lg:col-span-8"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="work-breakdown-heading" className="text-on-surface text-xl font-semibold">
            Hierarchical work breakdown
          </h2>
          <p className="text-on-surface-variant text-xs">
            {stories.length} {stories.length === 1 ? 'Story' : 'Stories'} · {epics.length}{' '}
            {epics.length === 1 ? 'Epic' : 'Epics'}
          </p>
        </div>
        {items.length === 0 ? (
          <p className="text-on-surface-variant mt-4 text-sm">This version has no items yet.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {epics.map((epic) => {
              const children = stories.filter(
                (story) => story.parentLogicalItemId === epic.logicalItemId,
              );
              return (
                <div
                  key={epic.itemVersionId}
                  className="bg-surface-container-low rounded-lg p-3 sm:p-4"
                >
                  <ul>
                    <BacklogItem item={epic} status={status} onEdit={onEdit} />
                  </ul>
                  <div className="border-surface-dim ml-3 border-l pl-3 sm:ml-6 sm:pl-4">
                    {children.length === 0 ? (
                      <p className="text-on-surface-variant mt-3 text-xs">
                        No Stories in this Epic.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {children.map((story) => (
                          <BacklogItem
                            key={story.itemVersionId}
                            item={story}
                            status={status}
                            onEdit={onEdit}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
            {ungrouped.length > 0 && (
              <section
                aria-labelledby="ungrouped-items-heading"
                className="bg-surface-container-low rounded-lg p-3 sm:p-4"
              >
                <h3 id="ungrouped-items-heading" className="text-on-surface text-sm font-semibold">
                  Items without a matching Epic
                </h3>
                <p className="text-on-surface-variant mt-1 text-xs">
                  These items remain visible for review.
                </p>
                <ul className="mt-3 space-y-2">
                  {ungrouped.map((item) => (
                    <BacklogItem
                      key={item.itemVersionId}
                      item={item}
                      status={status}
                      onEdit={onEdit}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </section>

      <aside aria-label="Backlog review context" className="space-y-4 lg:col-span-4">
        <section
          aria-labelledby="quality-gate-heading"
          className="border-surface-dim bg-surface-container-lowest rounded-lg border p-4 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="quality-gate-heading" className="text-on-surface text-base font-semibold">
              Quality gate
            </h2>
            <span className="bg-surface-container-low text-on-surface-variant rounded-md px-2 py-1 text-xs">
              {qualityIssues.length} {qualityIssues.length === 1 ? 'issue' : 'issues'}
            </span>
          </div>
          <p className="text-on-surface-variant mt-2 text-xs">
            Deterministic findings for review. These do not block approval.
          </p>
          {qualityIssues.length === 0 ? (
            <div className="bg-surface-container-low mt-4 flex gap-2 rounded-lg p-3 text-sm">
              <CircleCheck className="text-status-approved-bg size-4 shrink-0" aria-hidden="true" />
              <p>No deterministic quality issues found.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {qualityIssues.map((issue, index) => {
                const relatedItem = items.find(
                  (item) => item.logicalItemId === issue.logicalItemId,
                );
                return (
                  <li
                    key={`${issue.code}-${index}`}
                    className="border-surface-dim bg-surface-container-low rounded-lg border p-3"
                  >
                    <div className="flex items-start gap-2">
                      <CircleAlert
                        className="text-tertiary mt-0.5 size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-on-surface text-sm">{issue.message}</p>
                        <p className="font-mono-code text-on-surface-variant mt-1 text-xs">
                          {issue.code}
                          {relatedItem && ` · ${relatedItem.displayKey}`}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="traceability-heading"
          className="border-surface-dim bg-surface-container-lowest rounded-lg border p-4 shadow-sm sm:p-6"
        >
          <h2 id="traceability-heading" className="text-on-surface text-base font-semibold">
            Traceability
          </h2>
          <p className="text-on-surface mt-3 text-sm font-medium">
            {storiesWithRefs.length} of {stories.length} Stories have source references
          </p>
          <p className="text-on-surface-variant mt-1 text-xs">
            Counted from the Stories in this version. Reference validity is reported by the quality
            gate.
          </p>
          {storiesWithRefs.length > 0 && (
            <p className="font-mono-code text-on-surface-variant mt-3 text-xs">
              {storiesWithRefs.map((item) => item.displayKey).join(', ')}
            </p>
          )}
        </section>

        <section
          aria-labelledby="impact-heading"
          className="border-surface-dim bg-surface-container-lowest rounded-lg border p-4 shadow-sm sm:p-6"
        >
          <h2 id="impact-heading" className="text-on-surface text-base font-semibold">
            Impact
          </h2>
          {flaggedItems.length === 0 ? (
            <div className="bg-surface-container-low mt-3 flex items-start gap-2 rounded-lg p-3">
              <CircleCheck
                className="text-status-approved-bg mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p className="text-on-surface text-sm">
                No impact issues found. Every item in this version is current with its dependencies.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {flaggedItems.map(
                (item) =>
                  item.impact && (
                    <li
                      key={item.itemVersionId}
                      className="border-surface-dim bg-surface-container-low rounded-lg border p-3"
                    >
                      <div className="flex items-start gap-2">
                        {item.impact.acknowledged ? (
                          <CircleCheck
                            className="text-status-approved-bg mt-0.5 size-4 shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <FlaggedGlyph
                            title={`${item.displayKey} is flagged`}
                            className="mt-0.5"
                          />
                        )}
                        <p className="text-on-surface text-sm leading-relaxed">
                          <span className="font-mono-code font-semibold">{item.displayKey}</span> is
                          potentially affected by{' '}
                          <span className="font-mono-code font-semibold">
                            {item.impact.rootDisplayKey}
                          </span>
                          . Review path: {item.impact.path.join(' → ')}.
                          {item.impact.acknowledged && (
                            <span className="text-on-surface-variant"> Acknowledged.</span>
                          )}
                        </p>
                      </div>
                    </li>
                  ),
              )}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
