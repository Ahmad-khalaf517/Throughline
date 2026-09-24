// Presentation-layer fixture data for the artifact review screens (E5-S2/
// S3/S4/S5). As of E5-S4 (UI Requirements, the last gap) all four
// `ArtifactType` values have real fixture data here - see
// `getFixtureArtifactVersion`'s own doc comment below.
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
  ArchitectureOptionDTO,
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

// Architecture option payload shapes (TR FR-020: a structured stack
// descriptor plus candidate architecture decisions and trade-offs). Not part
// of the shared DTOs - `ArchitectureOptionDTO` deliberately types `stack` as
// `unknown` and `candidateDecisions`/`tradeoffs` as `unknown[]` there (API
// Contracts 1.8) - these local types exist only so the fixture literals
// below are checked against a real shape, same pattern as
// `RequirementItemPayload` above.
export interface ArchitectureStack {
  frontend: string;
  backend: string;
  database: string;
  hosting: string;
  repositoryLayout: string;
}

export interface ArchitectureCandidateDecision {
  decision: string;
  // Display keys of the requirement/constraint items that actually drove
  // this decision - FR-020: "only the requirement and constraint items that
  // actually drove it", never every constraint on every decision.
  drivenBy: string[];
  rationale: string;
}

// Backlog item payload shape (TR FR-061: "stable logical identity,
// item-version identity, display key such as S-12, title, description,
// acceptance criteria, priority when needed, source/dependency
// references"). Not part of the shared DTOs - same reasoning and pattern as
// `RequirementItemPayload`/`ArchitectureStack` above: `ItemVersionDTO.payload`
// stays `unknown` in the shared DTO, this local type only checks the fixture
// literals below against a real shape. Covers both Epic and Story items
// (FR-060: Tasks/Subtasks are out of scope for the MVP) - `acceptanceCriteria`
// /`priority`/`sourceRefs` are Story-only in practice (an Epic has neither
// acceptance criteria nor a source Requirement of its own) but left optional
// rather than split into two types, since the review screen reads every
// field defensively regardless of `itemType`.
export interface BacklogItemPayload {
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  priority?: string;
  sourceRefs?: string[]; // FR-062: display-key references to upstream item versions
}

// UI Requirement item payload shape (TR FR-040: "structured UI Requirements
// containing appropriate fields such as: target users, screens, user flows,
// navigation expectations, key components, responsive constraints,
// accessibility constraints, RTL/localization requirements, UX priorities").
// Not part of the shared DTOs - same reasoning and pattern as
// `RequirementItemPayload`/`BacklogItemPayload` above: `ItemVersionDTO.payload`
// stays `unknown` in the shared DTO, this local type only checks the fixture
// literals below against a real shape. `title`/`description` are required
// (every item needs something to render); the rest are FR-040's own field
// list, left optional since not every UI Requirement item needs every one of
// them. `sourceRefs` reuses the same generic cross-artifact reference field
// `BacklogItemPayload` already carries (API Contracts 1.8).
export interface UiRequirementItemPayload {
  title: string;
  description: string;
  targetUsers?: string[];
  screens?: string[];
  navigationExpectations?: string;
  responsiveConstraints?: string;
  accessibilityConstraints?: string;
  uxPriorities?: string[];
  sourceRefs?: string[];
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

// Architecture draft fixture (E5-S3). FR-020: exactly two options, each with
// project-specific trade-offs tied to this project's actual constraints -
// not generic technology comparison text - plus a structured stack
// descriptor and its own candidate decisions ("only the requirement and
// constraint items that actually drove it"). FR-021: each option carries a
// stable id (`optionKey`). FR-022: nothing is selected yet - selection only
// happens at approval, which is why `selectedArchitectureOptionId` is `null`
// below and `items` is empty (candidate decisions are not lineage while the
// version is a draft). Both options cite R-04 (the 5,000-concurrent-user
// constraint established in the requirements fixture above) so the two
// screens read as one consistent project, and each option reaches a
// different conclusion from that same constraint - that's what makes this a
// genuine choice rather than a strawman comparison.
function architectureOptions(): [ArchitectureOptionDTO, ArchitectureOptionDTO] {
  const stackA: ArchitectureStack = {
    frontend: 'Next.js (App Router), deployed to Vercel',
    backend: 'Next.js Route Handlers in the same application',
    database: 'Supabase Postgres, accessed through the Supavisor connection pooler',
    hosting: 'Vercel for the app, Supabase for the database and auth',
    repositoryLayout: 'One repository, one Next.js app',
  };
  const decisionsA: ArchitectureCandidateDecision[] = [
    {
      decision:
        'Use Supabase Postgres through the managed Supavisor pooler rather than self-managing a connection pool.',
      drivenBy: ['R-04'],
      rationale:
        'R-04 sets a 5,000-concurrent-user target; a managed pooler absorbs that connection load without the dedicated ops work a hand-tuned pool would need before launch.',
    },
    {
      decision:
        'Serve the API as Next.js Route Handlers inside the same application rather than as a separate service.',
      drivenBy: [],
      rationale:
        'One deployable keeps release and operations work inside what a single small team can own, without splitting attention across two codebases.',
    },
  ];
  const tradeoffsA = [
    'A single Next.js app is something a small team (this project has no dedicated platform engineer) can ship and operate inside a short delivery window, at the cost of coupling frontend and API release cycles together.',
    "Supavisor pooling reaches R-04's 5,000-concurrent-user target with no self-managed pooling infrastructure, but caps out at whatever pooling limits Supabase's plan allows rather than a fully hand-tuned pool.",
    "Vercel and Supabase both bill by usage, which keeps cost low at this MVP's scale, but neither gives the same raw scaling ceiling as a dedicated, independently-scaled backend would.",
  ];

  const stackB: ArchitectureStack = {
    frontend: 'Next.js (App Router), deployed to Vercel',
    backend: 'A separate Node.js API service on a dedicated container host',
    database: 'Self-managed Postgres behind a hand-configured PgBouncer pool',
    hosting: 'Vercel for the frontend; a dedicated host for the API and database',
    repositoryLayout:
      'Two repositories (or a monorepo with two deployables): frontend and API service',
  };
  const decisionsB: ArchitectureCandidateDecision[] = [
    {
      decision:
        'Run a self-managed PgBouncer pool in front of a dedicated Postgres instance instead of a managed pooler.',
      drivenBy: ['R-04'],
      rationale:
        "R-04's 5,000-concurrent-user target is comfortably inside what a self-managed pool can handle too, and owning the pool directly leaves headroom well past that number - at the cost of the pool-tuning and failover work Option A avoids.",
    },
    {
      decision:
        'Split the API into its own deployable service instead of colocating it with the frontend.',
      drivenBy: [],
      rationale:
        'Lets the API scale and release independently of the frontend, which matters once a team is large enough to own that surface separately - not yet the case for the small team behind this project.',
    },
  ];
  const tradeoffsB = [
    "A separately deployed API can scale past R-04's 5,000-user target with more headroom than Option A's pooled connection budget offers, but that headroom is more than this project's stated scale currently needs.",
    'Self-managing Postgres and PgBouncer calls for pool-tuning, failover, and patching skills the current small-team profile does not have budgeted time for, working against the same delivery deadline Option A protects.',
    'Two deployables add deployment complexity - coordinated releases, two sets of environment configuration - in exchange for a cleaner scaling boundary between frontend and API load.',
  ];

  return [
    {
      id: 'fixture-architecture-option-a',
      optionKey: 'A',
      title: 'Managed full-stack on Vercel + Supabase',
      summary:
        'Keep the frontend, API, and database on the same managed platforms this project already runs on: Next.js Route Handlers for the API, Supabase Postgres through Supavisor for the database, one repository.',
      stack: stackA,
      candidateDecisions: decisionsA,
      tradeoffs: tradeoffsA,
    },
    {
      id: 'fixture-architecture-option-b',
      optionKey: 'B',
      title: 'Separate API service + self-managed Postgres',
      summary:
        "Split the API into its own deployable service in front of a self-managed, hand-pooled Postgres instance, trading this project's current operational simplicity for scaling headroom beyond its stated load target.",
      stack: stackB,
      candidateDecisions: decisionsB,
      tradeoffs: tradeoffsB,
    },
  ];
}

function architectureFixture(): { version: ArtifactVersionDTO; qualityIssues: QualityIssueDTO[] } {
  const version: ArtifactVersionDTO = {
    id: 'fixture-version-architecture-v1',
    artifactId: 'fixture-artifact-architecture',
    artifactType: 'architecture',
    versionNumber: 1, // first Architecture draft, generated once Requirements was approved
    status: 'draft',
    statusReason: null,
    schemaVersion: 1,
    baseApprovedVersionId: null, // no prior approved Architecture version exists yet
    payload: null, // no artifact-level payload beyond `options` for this type
    rawOutput: null,
    items: [], // FR-020: candidate decisions aren't lineage while the version is a draft
    options: architectureOptions(),
    selectedArchitectureOptionId: null, // FR-022: set only at approval
    createdAt: '2026-09-21T09:10:00.000Z',
    updatedAt: '2026-09-21T09:10:00.000Z',
  };

  // API Contracts section 4: the quality-gate route is documented as empty
  // for `architecture` in P0.
  return { version, qualityIssues: [] };
}

// Backlog draft fixture (E5-S5). Same helper pattern as `itemVersion` above,
// but for Epic/Story items: `itemType` varies (epic vs story) and
// `parentLogicalItemId` is meaningful here (Story -> Epic membership, API
// Contracts 1.8) rather than always `null`.
function backlogItemVersion(
  displayKey: string,
  itemType: 'epic' | 'story',
  payload: BacklogItemPayload,
  opts: { parentLogicalItemId?: string | null; impact?: ImpactRowDTO | null } = {},
): ItemVersionDTO {
  return {
    itemVersionId: `fixture-item-version-${displayKey.toLowerCase()}`,
    logicalItemId: `fixture-logical-${displayKey.toLowerCase()}`,
    displayKey,
    itemType,
    revisionNumber: 1,
    payload,
    parentLogicalItemId: opts.parentLogicalItemId ?? null,
    impact: opts.impact ?? null,
  };
}

// E-01 is this backlog's one Epic (FR-060: Epics and Stories only, Tasks/
// Subtasks out of scope); every Story below carries E-01's `logicalItemId`
// as its `parentLogicalItemId`.
const E01_EPIC = backlogItemVersion('E-01', 'epic', {
  title: 'Traceable artifact review workflow',
  description:
    'Deliver the end-to-end review/approve experience across Requirements, Architecture, UI Requirements, and Backlog, including the quality gates and impact warnings that keep downstream work honest about its upstream sources.',
});

function backlogItems(): ItemVersionDTO[] {
  const epicLogicalId = E01_EPIC.logicalItemId;
  return [
    E01_EPIC,
    // S-01: clean - acceptance criteria present and a real source
    // Requirement, no impact. Implements R-01 (project creation from a
    // brief).
    backlogItemVersion(
      'S-01',
      'story',
      {
        title: 'Create a project from a name and a brief',
        description:
          'Implements R-01: a Project Owner submits a project name and a free-text brief, and the project is created from it.',
        acceptanceCriteria: [
          'Given a name and a non-empty brief, the project is created and the user is taken to its detail page.',
        ],
        priority: 'P1',
        sourceRefs: ['R-01'],
      },
      { parentLogicalItemId: epicLogicalId },
    ),
    // S-02: implements R-06's latency requirement, which is itself stated
    // relative to R-04's concurrency target (see R04_SCALE_CONSTRAINT
    // above) - R-04 changed, R-06 came back stale relative to it (INV-010/
    // INV-011), and that same change now ripples one hop further into this
    // Story: a third consumer flagged by the same root change, continuing
    // the narrative `requirementsItems()` already established rather than
    // inventing a new one. `depth: 1` because the path runs through R-06 as
    // an intermediate hop (R-04 -> R-06 -> S-02) - transitive, not direct
    // (R-06's own impact row above is `depth: 0`).
    backlogItemVersion(
      'S-02',
      'story',
      {
        title: 'Keep p95 latency within budget at target scale',
        description:
          "Implements R-06's latency budget, which is itself stated relative to R-04's concurrency target.",
        acceptanceCriteria: ['p95 API latency stays under 400ms at the scale stated in R-04.'],
        priority: 'P1',
        sourceRefs: ['R-06'],
      },
      {
        parentLogicalItemId: epicLogicalId,
        impact: {
          subjectKind: 'item_version',
          subjectId: 'fixture-item-version-s-02',
          rootItemVersionId: R04_SCALE_CONSTRAINT.itemVersionId,
          rootDisplayKey: 'R-04',
          depth: 1,
          path: ['R-04', 'R-06', 'S-02'],
          acknowledged: false,
        },
      },
    ),
    // S-03: deliberately fails two FR-063 P0 checks - empty acceptance
    // criteria and no source Requirement - so the quality gate section has
    // something real to show, the same role R-04's empty
    // `acceptanceCriteria` plays in `requirementsItems()` above.
    backlogItemVersion(
      'S-03',
      'story',
      {
        title: 'Surface the latest AI generation run status on the dashboard',
        description:
          'A dashboard tile shows whether the most recent AI generation run for this project succeeded or failed.',
        acceptanceCriteria: [],
        priority: 'P2',
        sourceRefs: [],
      },
      { parentLogicalItemId: epicLogicalId },
    ),
  ];
}

function backlogQualityIssues(items: ItemVersionDTO[]): QualityIssueDTO[] {
  const byKey = new Map(items.map((item) => [item.displayKey, item]));
  return [
    {
      code: 'MISSING_ACCEPTANCE_CRITERIA',
      message: 'Story has no acceptance criteria.', // FR-063's own example wording
      logicalItemId: byKey.get('S-03')?.logicalItemId ?? null,
    },
    {
      code: 'MISSING_SOURCE_REQUIREMENT',
      message: 'Story has no source Requirement.', // FR-063's own example wording
      logicalItemId: byKey.get('S-03')?.logicalItemId ?? null,
    },
  ];
}

function backlogFixture(): { version: ArtifactVersionDTO; qualityIssues: QualityIssueDTO[] } {
  const items = backlogItems();
  const version: ArtifactVersionDTO = {
    id: 'fixture-version-backlog-v1',
    artifactId: 'fixture-artifact-backlog',
    artifactType: 'backlog',
    // First Backlog draft, generated once Requirements + Architecture +
    // UI Requirements were all approved (FR-080).
    versionNumber: 1,
    status: 'draft',
    statusReason: null,
    schemaVersion: 1,
    baseApprovedVersionId: null, // no prior approved Backlog version exists yet
    payload: null, // FR-060/FR-061: no artifact-level payload beyond the Epic/Story items themselves
    rawOutput: null,
    items,
    options: null, // Backlog has no architecture-style options
    selectedArchitectureOptionId: null,
    createdAt: '2026-09-23T11:05:00.000Z',
    updatedAt: '2026-09-23T11:05:00.000Z',
  };

  return { version, qualityIssues: backlogQualityIssues(items) };
}

// UI Requirements draft fixture (E5-S4, the last artifact-type gap in this
// file). Same helper pattern as `itemVersion`/`backlogItemVersion` above, but
// for `ui_requirement` items, which have no parent item of their own
// (`parentLogicalItemId` is always `null` - only Story -> Epic is a real
// parent relationship, API Contracts 1.8).
function uiRequirementItemVersion(
  displayKey: string,
  payload: UiRequirementItemPayload,
  opts: { impact?: ImpactRowDTO | null } = {},
): ItemVersionDTO {
  return {
    itemVersionId: `fixture-item-version-${displayKey.toLowerCase()}`,
    logicalItemId: `fixture-logical-${displayKey.toLowerCase()}`,
    displayKey,
    itemType: 'ui_requirement',
    revisionNumber: 1,
    payload,
    parentLogicalItemId: null,
    impact: opts.impact ?? null,
  };
}

function uiRequirementsItems(): ItemVersionDTO[] {
  return [
    // UI-01: a genuinely project-specific item - it describes the actual
    // built project-creation/brief-entry screen (E5-S1, this codebase's
    // `/projects` route: `src/app/projects/page.tsx` +
    // `new-project-form.tsx`), not generic placeholder UI copy. Clean, no
    // impact.
    uiRequirementItemVersion('UI-01', {
      title: 'Project list + creation screen',
      description:
        'The first authenticated screen after sign-in: a list of the signed-in ' +
        "Project Owner's existing projects (name and a two-line brief excerpt, " +
        'each linking to its detail page) above a "New project" form with a ' +
        'name field and a free-text brief textarea. Submitting takes the owner ' +
        "straight to the new project's detail page.",
      targetUsers: ['Project Owner'],
      screens: ['Project list', 'New project form'],
      navigationExpectations:
        'Reachable immediately after sign-in; each project card links to its ' +
        "own detail page; submitting the form navigates to the new project's " +
        'detail page.',
      responsiveConstraints:
        'Single-column layout at every width (a max-width content column) - no ' +
        'separate mobile layout needed.',
      accessibilityConstraints:
        'Name and brief fields are labelled form controls; the submit action ' +
        'is reachable and operable by keyboard alone; a failed submission is ' +
        'reported as inline text, not by color alone.',
      uxPriorities: [
        'Fast path from sign-in to a created project',
        'No dead-end empty state for a first-time owner with zero projects',
      ],
    }),
    // UI-02: continues the R-04 -> R-06 narrative one hop further (see
    // `requirementsItems()`'s R-06 and `backlogItems()`'s S-02 above) - a UI
    // Requirement item whose own behavior is sensitive to the same latency
    // budget: the Requirements review screen itself needs to stay responsive
    // at R-04's stated concurrency target, per R-06's p95 budget. `depth: 1`
    // because the path runs through R-06 as an intermediate hop
    // (R-04 -> R-06 -> UI-02) - transitive, not direct, same convention
    // S-02 uses in `backlogItems()`.
    uiRequirementItemVersion(
      'UI-02',
      {
        title: 'Requirements review screen must stay responsive at target scale',
        description:
          "The Requirements review/approve screen's own interactions - " +
          "approve, quality-gate read, impact read - must stay inside R-06's " +
          "p95 latency budget once the system is running at R-04's stated " +
          'concurrency, not just in a lightly-loaded demo.',
        targetUsers: ['Requirements Reviewer'],
        screens: ['Requirements review screen'],
        navigationExpectations:
          'No new navigation - applies to the existing Requirements review ' + 'screen in place.',
        responsiveConstraints:
          "Interaction latency stays within R-06's p95 budget at R-04's " + 'stated concurrency.',
        uxPriorities: ['Perceived responsiveness under load, not just correctness'],
        sourceRefs: ['R-06'],
      },
      {
        impact: {
          subjectKind: 'item_version',
          subjectId: 'fixture-item-version-ui-02',
          rootItemVersionId: R04_SCALE_CONSTRAINT.itemVersionId,
          rootDisplayKey: 'R-04',
          depth: 1,
          path: ['R-04', 'R-06', 'UI-02'],
          acknowledged: false,
        },
      },
    ),
  ];
}

function uiRequirementsFixture(): {
  version: ArtifactVersionDTO;
  qualityIssues: QualityIssueDTO[];
} {
  const items = uiRequirementsItems();
  const version: ArtifactVersionDTO = {
    id: 'fixture-version-ui-requirements-v1',
    artifactId: 'fixture-artifact-ui-requirements',
    artifactType: 'ui_requirements',
    // First UI Requirements draft, generated once Requirements + Architecture
    // were both approved (FR-041/FR-080).
    versionNumber: 1,
    status: 'draft',
    statusReason: null,
    schemaVersion: 1,
    baseApprovedVersionId: null, // no prior approved UI Requirements version exists yet
    payload: null, // FR-040: no artifact-level payload beyond the UI Requirement items themselves
    rawOutput: null,
    items,
    options: null, // UI Requirements has no architecture-style options
    selectedArchitectureOptionId: null,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
  };

  // API Contracts section 4: the quality-gate route is documented as empty
  // for `ui_requirements` in P0.
  return { version, qualityIssues: [] };
}

// TODO(E3-S10): replace `requirementsFixture`/`architectureFixture`/
// `uiRequirementsFixture`/`backlogFixture` with a live artifact-lifecycle
// read once the generation/approval routes exist - see the header comment
// above for why this is a one-function swap.
/**
 * The one swap point for E3-S10/E3-S11 (see header comment). Returns
 * realistic fixture data for all four `ArtifactType` values -
 * `ui_requirements` (E5-S4) was the last gap; every real artifact type now
 * has real fixture data at this layer. `null` stays part of the return type
 * for forward compatibility with a real "not yet available" API response
 * (and is still what any unrecognized/future type would get), but every
 * branch below is covered today - callers still treat `null` as "not yet
 * available for this artifact type", not as an error, should that ever
 * matter again.
 */
export function getFixtureArtifactVersion(
  type: ArtifactType,
): { version: ArtifactVersionDTO; qualityIssues: QualityIssueDTO[] } | null {
  if (type === 'requirements') return requirementsFixture();
  if (type === 'architecture') return architectureFixture();
  if (type === 'ui_requirements') return uiRequirementsFixture();
  if (type === 'backlog') return backlogFixture();
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
