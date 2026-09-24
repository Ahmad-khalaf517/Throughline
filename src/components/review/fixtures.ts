// Presentation-layer fixture data for the artifact review screens (E5-S2).
//
// E3-S10 (the artifact generate/approve/quality-gate routes) and E3-S11 (the
// impact routes) do not exist yet - this module stands in for both, typed
// against the exact shapes API Contracts 1.8 documents, so the review screen
// can be built and reviewed now rather than waiting on a formal dependency
// that isn't scheduled yet. It is deliberately NOT a domain module: it owns
// no table, calls no other module, and lives under components/ rather than
// src/artifact-types or src/lineage.
//
// TODO(E3-S10/E3-S11): replace with a live artifact-lifecycle/impact read
// once those modules exist. `getFixtureArtifactVersion` is the swap point -
// a page component only ever calls this one function, so wiring in the real
// `GET /api/artifact-versions/:versionId` + quality-gate calls later is a
// one-function change, not a screen rewrite.
import type {
  ArtifactType,
  ArtifactVersionDTO,
  ImpactRowDTO,
  ItemVersionDTO,
  QualityIssueDTO,
} from '@/lib/serialize';

// Requirement item payload shape (TR FR-010/FR-011, section 22's semantic
// field table: "type (functional, non-functional, or constraint with its
// dimension), actor, behavior, constraints, acceptance criteria"). Not part
// of the shared DTOs - `ItemVersionDTO.payload` is deliberately `unknown`
// there because each artifact-type module owns its own payload shape
// (API Contracts 1.8) - this type exists only so the fixture literals below
// are checked against the real shape instead of being untyped object blobs.
export interface RequirementItemPayload {
  type: 'functional' | 'non_functional' | 'constraint';
  dimension?: string; // constraint items only, one per dimension (FR-010)
  actor?: string;
  behavior: string;
  acceptanceCriteria: string[];
}

// Requirements artifact payload (the "not dependable" fields from FR-010:
// business problem, actors, assumptions, unresolved questions, user
// journeys - never lineage-tracked items themselves).
export interface RequirementsArtifactPayload {
  businessProblem: string;
  actors: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
  userJourneys: string[];
}

function itemVersion(
  displayKey: string,
  payload: RequirementItemPayload,
  opts: { revisionNumber?: number; impact?: ImpactRowDTO | null } = {},
): ItemVersionDTO {
  return {
    itemVersionId: `fixture-item-version-${displayKey.toLowerCase()}`,
    logicalItemId: `fixture-logical-${displayKey.toLowerCase()}`,
    displayKey,
    itemType: 'requirement',
    revisionNumber: opts.revisionNumber ?? 1,
    payload,
    parentLogicalItemId: null, // only Story items have an Epic parent (API Contracts 1.8)
    impact: opts.impact ?? null,
  };
}

// R-04 is this draft's "changed root": this is a regeneration of a
// previously-approved Requirements version (versionNumber 2 below), and
// R-04 came back modified (INV-011: same logicalItemId, new itemVersionId,
// revisionNumber bumped 1 -> 2) while every other item, including R-06,
// came back unchanged and reused its existing ItemVersion (INV-010) - which
// is exactly how R-06 ends up stale relative to R-04's new content. R-04
// itself carries no impact - a changed item is the *source* of a flag, not
// a subject of one (TR section 25).
const R04_SCALE_CONSTRAINT = itemVersion(
  'R-04',
  {
    type: 'constraint',
    dimension: 'scale',
    behavior: 'The system must support up to 5,000 concurrent authenticated users at launch.',
    acceptanceCriteria: [], // deliberately empty - drives the MISSING_ACCEPTANCE_CRITERIA quality issue below
  },
  { revisionNumber: 2 },
);

function requirementsItems(): ItemVersionDTO[] {
  return [
    itemVersion('R-01', {
      type: 'functional',
      actor: 'Project Owner',
      behavior: 'can create a new project by submitting a name and a free-text brief.',
      acceptanceCriteria: [
        'Given a name and a non-empty brief, the project is created and the user is taken to its detail page.',
        'The brief stays editable until the first Requirements version exists (INV-007).',
      ],
    }),
    itemVersion('R-02', {
      type: 'functional',
      actor: 'Project Owner',
      behavior: 'can trigger AI generation of the Requirements artifact from the project brief.',
      acceptanceCriteria: [
        'Generation produces a draft ArtifactVersion with system-owned display keys (FR-011).',
        'A second generation attempt without an approved base replaces the existing draft rather than creating a second one.',
      ],
    }),
    itemVersion('R-03', {
      type: 'non_functional',
      behavior:
        'Approving a Requirements version must be blocked while any of its own items would be flagged and unacknowledged (FR-083).',
      acceptanceCriteria: [
        'Submitting an approval against a version with an unacknowledged flagged item returns a blocking response naming the item and the cause.',
        'An approve-anyway override requires a non-empty note and is recorded as an override event (FR-084).',
      ],
    }),
    R04_SCALE_CONSTRAINT,
    itemVersion('R-05', {
      type: 'functional',
      actor: 'Requirements Reviewer',
      behavior:
        'can view every deterministic quality-gate issue for a Requirements draft before approving it.',
      acceptanceCriteria: [
        'The quality gate lists each issue with a human-readable message (FR-012).',
        'An empty issue list is shown as a clean pass, not as an empty/error state.',
      ],
    }),
    itemVersion(
      'R-06',
      {
        type: 'non_functional',
        behavior:
          "Response-time budgets must stay consistent with R-04's stated concurrency scale - if the target load changes, latency targets need review.",
        acceptanceCriteria: ['p95 API latency stays under 400ms at the scale stated in R-04.'],
      },
      {
        impact: {
          subjectKind: 'item_version',
          subjectId: 'fixture-item-version-r-06',
          rootItemVersionId: R04_SCALE_CONSTRAINT.itemVersionId,
          rootDisplayKey: 'R-04',
          // Direct impact (depth 0, per ERD section 6.1's depth convention -
          // R-06 depends on R-04 directly, with no intermediate item on the
          // path). Was `1` before this story's fix.
          depth: 0,
          path: ['R-04', 'R-06'],
          acknowledged: false,
        },
      },
    ),
  ];
}

function requirementsQualityIssues(items: ItemVersionDTO[]): QualityIssueDTO[] {
  const byKey = new Map(items.map((item) => [item.displayKey, item]));
  return [
    {
      code: 'MISSING_ACCEPTANCE_CRITERIA',
      message: 'R-04 (constraint: scale) has no acceptance criteria.',
      logicalItemId: byKey.get('R-04')?.logicalItemId ?? null,
    },
    {
      code: 'UNRESOLVED_ASSUMPTION',
      message:
        'The brief leaves the deployment region unresolved; the draft assumes single-region deployment, which has not been confirmed.',
      logicalItemId: null, // a payload-level assumption (FR-010), not tied to one item
    },
    {
      code: 'MALFORMED_ITEM',
      message:
        'R-06 has no bound actor - non-functional requirements should still name who or what the requirement protects.',
      logicalItemId: byKey.get('R-06')?.logicalItemId ?? null,
    },
  ];
}

function requirementsFixture(): { version: ArtifactVersionDTO; qualityIssues: QualityIssueDTO[] } {
  const items = requirementsItems();
  const payload: RequirementsArtifactPayload = {
    businessProblem:
      'Teams building AI-generated software artifacts lose the ability to tell which downstream work still reflects an upstream decision once that decision changes.',
    actors: ['Project Owner', 'Requirements Reviewer'],
    assumptions: [
      'A single Postgres instance (Supabase) is available in the target deployment region.',
      'The initial launch audience is internal reviewers, not the general public.',
    ],
    unresolvedQuestions: [
      'Is a single-region deployment acceptable for launch, or is multi-region required?',
    ],
    userJourneys: [
      'A Project Owner enters a brief, triggers generation, and reviews the resulting Requirements draft before approving it.',
    ],
  };

  const version: ArtifactVersionDTO = {
    id: 'fixture-version-requirements-v2',
    artifactId: 'fixture-artifact-requirements',
    artifactType: 'requirements',
    versionNumber: 2,
    status: 'draft',
    statusReason: null,
    schemaVersion: 1,
    // References the (not separately modeled in this fixture set) approved
    // v1 this draft was regenerated from - INV-013's comparison base.
    baseApprovedVersionId: 'fixture-version-requirements-v1',
    payload,
    rawOutput: null,
    items,
    options: null,
    selectedArchitectureOptionId: null,
    createdAt: '2026-09-20T14:32:00.000Z',
    updatedAt: '2026-09-20T14:32:00.000Z',
  };

  return { version, qualityIssues: requirementsQualityIssues(items) };
}

/**
 * The one swap point for E3-S10/E3-S11 (see header comment). Returns
 * realistic fixture data for `requirements` only; the other three artifact
 * types return `null` until E5-S3/S4/S5 extend this same function with their
 * own fixtures - callers must treat `null` as "not yet available for this
 * artifact type", not as an error.
 */
export function getFixtureArtifactVersion(
  type: ArtifactType,
): { version: ArtifactVersionDTO; qualityIssues: QualityIssueDTO[] } | null {
  if (type === 'requirements') return requirementsFixture();
  return null;
}

/**
 * Fixture data for the warning panel (E5-S6). E3-S11 (the impact routes)
 * doesn't exist yet - this stands in for `GET /api/projects/:projectId/impact`
 * -> `{ warnings: ImpactRowDTO[] }` (API Contracts section 6), typed against
 * the real `ImpactRowDTO` shape so the panel can be built and reviewed now.
 * `projectId` is accepted but unused, only so the call site already reads
 * like the real route it will become.
 *
 * Two rows, both caused by R-04's change (see `R04_SCALE_CONSTRAINT` above):
 * a direct one that mirrors R-06's own impact row exactly, and a transitive
 * one showing a downstream external ref two hops out - INV-022's "never
 * flatten direct and transitive into one list" needs both kinds present in
 * the fixture to be demonstrable at all.
 *
 * TODO(E3-S11): replace with a live `impact.getWarnings` read once that
 * module exists - `WarningPanel` only ever consumes `ImpactRowDTO[]`, so
 * this is a one-function swap, not a screen rewrite.
 */
export function getFixtureImpactWarnings(projectId: string): ImpactRowDTO[] {
  void projectId;
  return [
    {
      subjectKind: 'item_version',
      subjectId: 'fixture-item-version-r-06',
      rootItemVersionId: R04_SCALE_CONSTRAINT.itemVersionId,
      rootDisplayKey: 'R-04',
      depth: 0,
      path: ['R-04', 'R-06'],
      acknowledged: false,
    },
    {
      subjectKind: 'external_ref',
      subjectId: 'fixture-external-ref-github-readme',
      rootItemVersionId: R04_SCALE_CONSTRAINT.itemVersionId,
      rootDisplayKey: 'R-04',
      depth: 1,
      path: ['R-04', 'R-06', 'GitHub: README.md'],
      acknowledged: false,
    },
  ];
}
