import type {
  ArtifactType,
  ArtifactVersionDTO,
  ArtifactVersionStatus,
  ImpactRowDTO,
} from '@/lib/serialize';
import { FlaggedGlyph } from '@/components/status/status-badge';

interface DependencyGraphProps {
  version: ArtifactVersionDTO;
  warnings: ImpactRowDTO[];
}

/**
 * The dependency/version visualization (E5-S7, TR section 27): "a simple
 * dependency/version view... a demo and comprehension feature, not a
 * graph-editing product." No `'use client'` here - nothing below is
 * interactive (no drag/zoom/pan, per TR section 27's explicit "do not build
 * a complex interactive DAG editor for P0"), so this stays a plain
 * presentational component like the TR example itself: a vertical chain of
 * boxes connected by arrows, each labeled with a status.
 *
 * Renders two chains, stacked vertically (this story's scoping call - TR
 * section 27's own example spans Requirements->Architecture->Backlog->Jira,
 * but only `requirements` has fixture data today; the other artifact types
 * are separate, later tickets):
 *
 * 1. A version-level chain: this draft and the approved version it was
 *    regenerated from (`baseApprovedVersionId`).
 * 2. An item-level chain: the *same* `ImpactRowDTO[]` the warning panel
 *    reads (`getFixtureImpactWarnings`), merged into one path - TR section
 *    27: "must use the same dependency data and traversal rules as the
 *    warning engine... must not contain an independent implementation of
 *    staleness logic."
 *
 * Both chains render as inline SVG (rect + text boxes, line+arrowhead
 * connectors) - no charting library. A plain-text caption restates the same
 * chain in prose beneath the SVG: screen-kit accessibility rule 4 requires
 * the impact path be "readable as plain text, not only as graph geometry"
 * since a screen reader never sees the SVG's visual geometry.
 */
export function DependencyGraph({ version, warnings }: DependencyGraphProps) {
  const chain = buildDependencyChain(warnings);
  const caption = buildCaption(version, chain);

  return (
    <div className="flex flex-col gap-6">
      <section className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h2 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
          Version chain
        </h2>
        <div className="mt-4">
          <VersionChainDiagram version={version} />
        </div>
      </section>

      <section className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <h2 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
          Dependency chain
        </h2>
        <div className="mt-4">
          {chain.length === 0 ? (
            <p className="text-on-surface-variant text-sm">No dependency data available.</p>
          ) : (
            <ItemChainDiagram chain={chain} />
          )}
        </div>
      </section>

      {/* Plain-text restatement of the same chain (screen-kit accessibility
          rule 4) - not decorative, the only version of this content a
          screen reader can consume. */}
      <p className="text-on-surface text-sm leading-relaxed">{caption}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared vertical-stack layout (used by both diagrams below)
// ---------------------------------------------------------------------------

const NODE_WIDTH = 260;
const NODE_HEIGHT = 48;
const NODE_GAP = 36; // vertical space between boxes, where the arrow lives
const MARGIN = 12;

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PositionedNode<T> {
  item: T;
  rect: NodeRect;
}

/**
 * Positions an arbitrary list of items in a single vertical stack, pairing
 * each with its box. One small function so a future 5th/6th node (later
 * artifact types extending TR section 27's own multi-type example) just
 * extends the stack instead of needing new hardcoded coordinates or
 * overlapping a fixed-size canvas. Returns items zipped with their rects
 * (rather than a bare rect array) so callers never index a rect array by
 * position - `noUncheckedIndexedAccess` would make that a real bug risk, not
 * just a style nit.
 */
function layoutVerticalChain<T>(items: T[]): {
  positioned: PositionedNode<T>[];
  viewWidth: number;
  viewHeight: number;
} {
  const count = items.length;
  const positioned = items.map((item, index) => ({
    item,
    rect: {
      x: MARGIN,
      y: MARGIN + index * (NODE_HEIGHT + NODE_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    },
  }));
  const viewHeight =
    count === 0 ? MARGIN * 2 : MARGIN * 2 + count * NODE_HEIGHT + (count - 1) * NODE_GAP;
  return { positioned, viewWidth: NODE_WIDTH + MARGIN * 2, viewHeight };
}

/** Every adjacent pair in a list, for drawing one arrow per consecutive box. */
function consecutivePairs<T>(items: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let index = 0; index < items.length - 1; index += 1) {
    const from = items[index];
    const to = items[index + 1];
    if (from !== undefined && to !== undefined) pairs.push([from, to]);
  }
  return pairs;
}

function ChainArrow({ from, to, markerId }: { from: NodeRect; to: NodeRect; markerId: string }) {
  const x = from.x + from.width / 2;
  return (
    <line
      x1={x}
      y1={from.y + from.height}
      x2={x}
      y2={to.y}
      stroke="var(--color-outline-variant)"
      strokeWidth={1.5}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function ArrowheadMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-outline-variant)" />
      </marker>
    </defs>
  );
}

// ---------------------------------------------------------------------------
// Version-level chain (this draft + the approved version it was regenerated
// from)
// ---------------------------------------------------------------------------

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  requirements: 'Requirements',
  architecture: 'Architecture',
  ui_requirements: 'UI Requirements',
  backlog: 'Backlog',
};

const VERSION_STATUS_STYLE: Record<
  ArtifactVersionStatus,
  { label: string; text: string; dashed?: boolean }
> = {
  draft: { label: 'DRAFT', text: 'var(--color-status-draft-text)', dashed: true },
  approved: { label: 'APPROVED', text: 'var(--color-status-approved-bg)' },
  superseded: { label: 'SUPERSEDED', text: 'var(--color-status-superseded-text)' },
  rejected: { label: 'REJECTED', text: 'var(--color-status-rejected)' },
};

interface VersionNodeData {
  label: string;
  style: (typeof VERSION_STATUS_STYLE)[ArtifactVersionStatus];
}

/**
 * The fixture's base version (v1) isn't a full `ArtifactVersionDTO` object
 * (see fixtures.ts) - only its version number can be derived, from
 * `versionNumber - 1`, and only `baseApprovedVersionId` says whether it
 * exists at all. Its status is always `approved`: `baseApprovedVersionId` is
 * INV-013's comparison base, which is defined as the artifact's current
 * *authoritative approved* version - never a guess.
 */
function buildVersionChain(version: ArtifactVersionDTO): VersionNodeData[] {
  const typeLabel = ARTIFACT_TYPE_LABELS[version.artifactType];
  const previousVersionNumber = version.versionNumber - 1;
  const hasBase = version.baseApprovedVersionId !== null && previousVersionNumber >= 1;
  const nodes: VersionNodeData[] = [
    {
      label: `${typeLabel} v${version.versionNumber}`,
      style: VERSION_STATUS_STYLE[version.status],
    },
  ];
  if (hasBase) {
    nodes.push({
      label: `${typeLabel} v${previousVersionNumber}`,
      style: VERSION_STATUS_STYLE.approved,
    });
  }
  return nodes;
}

function VersionChainDiagram({ version }: { version: ArtifactVersionDTO }) {
  const typeLabel = ARTIFACT_TYPE_LABELS[version.artifactType];
  const { positioned, viewWidth, viewHeight } = layoutVerticalChain(buildVersionChain(version));
  const markerId = 'dependency-graph-version-arrow';

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      className="h-auto w-full max-w-xs"
      role="img"
      aria-label={`${typeLabel} version chain`}
    >
      <ArrowheadMarker id={markerId} />
      {consecutivePairs(positioned).map(([from, to]) => (
        <ChainArrow
          key={`${from.item.label}->${to.item.label}`}
          from={from.rect}
          to={to.rect}
          markerId={markerId}
        />
      ))}
      {positioned.map(({ item, rect }) => (
        <VersionNode key={item.label} rect={rect} label={item.label} style={item.style} />
      ))}
    </svg>
  );
}

function VersionNode({
  rect,
  label,
  style,
}: {
  rect: NodeRect;
  label: string;
  style: VersionNodeData['style'];
}) {
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={8}
        fill="var(--color-surface-container-lowest)"
        stroke={style.dashed ? 'var(--color-status-draft-border)' : 'var(--color-outline-variant)'}
        strokeWidth={1.5}
        strokeDasharray={style.dashed ? '4 3' : undefined}
      />
      <text
        x={rect.x + 16}
        y={rect.y + 20}
        className="font-mono-code"
        fontSize={14}
        fontWeight={600}
        fill="var(--color-on-surface)"
      >
        {label}
      </text>
      {/* Status distinguished by its own text (never color alone) - a
          dashed border on top of that for `draft`, matching StatusBadge's
          own treatment. */}
      <text
        x={rect.x + 16}
        y={rect.y + 38}
        fontSize={11}
        fontWeight={700}
        letterSpacing="0.04em"
        fill={style.text}
      >
        {style.label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Item-level chain (the same ImpactRowDTO[] data as the warning panel)
// ---------------------------------------------------------------------------

interface ChainStep {
  label: string;
  // The row whose path ends at this label, i.e. this label is that row's
  // subject - `null` for the root (a changed item is a cause, not a
  // subject, TR section 25) and for a pass-through node with no row of its
  // own (not expected at P0 scale, defended anyway).
  row: ImpactRowDTO | null;
}

/**
 * Builds one root-to-leaf chain from the warning engine's own
 * `ImpactRowDTO[]` output - TR section 27's "same dependency data and
 * traversal rules as the warning engine... not an independent
 * implementation." At P0 scale every row's `path` shares the same root and
 * the longest path is a strict extension of every shorter one (fixtures.ts's
 * two rows: `['R-04','R-06']` and `['R-04','R-06','GitHub: README.md']`) -
 * so "merge" here is just picking that longest path as the backbone and
 * attaching each row to the step where its own path ends. No separate
 * traversal, comparison, or staleness logic of its own.
 */
function buildDependencyChain(warnings: ImpactRowDTO[]): ChainStep[] {
  if (warnings.length === 0) return [];
  const longestPath = warnings.reduce<string[]>(
    (best, row) => (row.path.length > best.length ? row.path : best),
    [],
  );
  const rowBySubjectLabel = new Map<string, ImpactRowDTO>();
  for (const row of warnings) {
    const subjectLabel = row.path[row.path.length - 1] ?? row.subjectId;
    rowBySubjectLabel.set(subjectLabel, row);
  }
  return longestPath.map((label, index) => ({
    label,
    row: index === 0 ? null : (rowBySubjectLabel.get(label) ?? null),
  }));
}

function ItemChainDiagram({ chain }: { chain: ChainStep[] }) {
  const { positioned, viewWidth, viewHeight } = layoutVerticalChain(chain);
  const markerId = 'dependency-graph-item-arrow';
  const rootLabel = chain[0]?.label ?? '';

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      className="h-auto w-full max-w-xs"
      role="img"
      aria-label={`Dependency chain starting from ${rootLabel}`}
    >
      <ArrowheadMarker id={markerId} />
      {consecutivePairs(positioned).map(([from, to]) => (
        <ChainArrow
          key={`${from.item.label}->${to.item.label}`}
          from={from.rect}
          to={to.rect}
          markerId={markerId}
        />
      ))}
      {positioned.map(({ item, rect }, index) => (
        <ItemNode key={item.label} rect={rect} step={item} isRoot={index === 0} />
      ))}
    </svg>
  );
}

function ItemNode({ rect, step, isRoot }: { rect: NodeRect; step: ChainStep; isRoot: boolean }) {
  // `item_version` subjects (and the root, always a requirement item here)
  // get the mono display-key treatment; `external_ref` subjects are free
  // text, styled as plain emphasis - same convention as WarningRow.
  const isExternal = step.row?.subjectKind === 'external_ref';
  const acknowledged = step.row?.acknowledged ?? false;
  const showFlag = !isRoot && step.row !== null && !acknowledged;
  const textX = isRoot ? rect.x + 16 : rect.x + 34;

  const subLabel = isRoot
    ? 'Changed'
    : step.row === null
      ? ''
      : acknowledged
        ? 'Acknowledged'
        : 'Needs review';

  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={8}
        fill="var(--color-surface-container-lowest)"
        stroke={isRoot ? 'var(--color-primary-container)' : 'var(--color-outline-variant)'}
        strokeWidth={isRoot ? 2 : 1.5}
      />
      <text
        x={textX}
        y={rect.y + 20}
        className={isExternal ? undefined : 'font-mono-code'}
        fontSize={13}
        fontWeight={600}
        fill="var(--color-on-surface)"
      >
        {step.label}
      </text>
      {subLabel && (
        <text x={textX} y={rect.y + 38} fontSize={11} fill="var(--color-on-surface-variant)">
          {subLabel}
        </text>
      )}
      {/* The root is the "changed" source, not a subject of impact - it gets
          the distinct "Changed" text label above, never FlaggedGlyph (that
          glyph means "this needs review", which is never true of the cause
          itself). */}
      {showFlag && (
        <foreignObject x={rect.x + 10} y={rect.y + 15} width={18} height={18}>
          <div>
            <FlaggedGlyph title={`${step.label} needs review`} />
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Plain-text caption (screen-kit accessibility rule 4)
// ---------------------------------------------------------------------------

function buildCaption(version: ArtifactVersionDTO, chain: ChainStep[]): string {
  const typeLabel = ARTIFACT_TYPE_LABELS[version.artifactType];
  const previousVersionNumber = version.versionNumber - 1;
  const hasBase = version.baseApprovedVersionId !== null && previousVersionNumber >= 1;
  const versionSentence = hasBase
    ? `${typeLabel} v${version.versionNumber} supersedes v${previousVersionNumber}.`
    : `${typeLabel} v${version.versionNumber} has no prior approved version yet.`;

  if (chain.length === 0) {
    return `${versionSentence} No dependency data is available for this version.`;
  }

  const stepSentences: string[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const step = chain[index];
    if (!step) continue;
    if (index === 0) {
      stepSentences.push(`${step.label} changed`);
      continue;
    }
    const previousLabel = chain[index - 1]?.label ?? '';
    if (!step.row) {
      stepSentences.push(`${step.label} is on the dependency path from ${previousLabel}`);
    } else if (step.row.depth === 0) {
      stepSentences.push(
        `${step.label} depends on ${previousLabel} directly and is potentially affected`,
      );
    } else if (step.row.subjectKind === 'external_ref') {
      stepSentences.push(
        `a ${step.label} reference created from ${previousLabel} is transitively affected`,
      );
    } else {
      stepSentences.push(
        `${step.label} depends on ${previousLabel} transitively and is potentially affected`,
      );
    }
  }

  return `${versionSentence} ${stepSentences.join('; ')}.`;
}
