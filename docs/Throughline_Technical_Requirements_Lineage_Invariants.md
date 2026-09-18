# Throughline - Technical Requirements & Lineage Invariants

**Document version:** 1.2  
**Project type:** AI-assisted software project initialization platform  
**Delivery context:** Solo capstone project, 8 full-time development days  
**Status:** Technical baseline aligned with Throughline BRD v2.2 and the final approved lineage/workflow decisions; parent document for ERD/Data Model -> Modules -> API Contracts -> Jira Plan -> Implementation  
**Primary audience:** Developer, technical reviewers, and AI coding agents

### Revision 1.2 alignment

Version 1.2 keeps the v1.1 technical baseline unchanged in substance and applies two scope/documentation clarifications: the duplicated business/evaluation reference sections are merged into one, and `FR-023 - Architecture Team-Skill Warning` is explicitly classified as P1. The document remains aligned with **Throughline BRD v2.2** and the final approved modeling decisions.

---

## 1. Purpose of This Document

This document defines the detailed software requirements, lineage invariants, integration behavior, and implementation guardrails for Throughline.

The business case, stakeholders, market risks, cost model, and evaluation goals are defined separately in **Throughline - Business Requirements Document (BRD) v2.2**. This technical document is intentionally engineering-focused and is the direct parent of the ERD/Data Model, modules, API contracts, Jira implementation plan, and code.

It is written to be readable by humans and precise enough for AI coding agents to follow without inventing missing behavior. If a later design or implementation conflicts with this document, the conflict shall be resolved explicitly before coding continues.

---

## 2. Executive Summary

Throughline is an **AI-assisted software project initialization platform**.

A user starts with a plain-language software project brief. Throughline helps transform that brief into:

1. Requirements and structured project context
2. Two architecture options with project-specific trade-offs
3. A GitHub repository initialized from the approved architecture
4. Structured UI requirements
5. A UI prototype generated through Google Stitch
6. An implementation backlog with Epics and Stories
7. Jira issues created from the approved backlog

The main differentiator is not document generation by itself. The main differentiator is **traceability**.

Throughline records which exact requirement, architecture decision, and UI requirement version produced each downstream item. When an approved upstream item changes, Throughline identifies the specific downstream items that may need review.

Example:

```text
Requirements v2
  R-07 Authentication
        |
        v
Architecture v1
  ADR-03 Authentication Strategy
        |
        v
Backlog v3
  S-12 Login
  S-13 Password Reset
        |
        v
Jira
  THR-42
  THR-43
```

If R-07 changes in Requirements v3, Throughline shall identify the affected architecture decisions, stories, and Jira issues rather than declaring the entire project stale.

---

## 3. Product Positioning

### 3.1 Working Product Name

**Throughline**

### 3.2 Short Positioning

> From brief to repo and backlog, with every artifact traceable to the decision it came from.

### 3.3 Longer Product Description

Throughline is an AI-assisted software project initialization platform that turns a software project brief into requirements, architecture, UI direction, repository setup, and an executable Jira backlog while preserving the lineage of project decisions so teams can understand what downstream work may be affected when those decisions change.

### 3.4 What Throughline Is Not

Throughline shall not be positioned primarily as an **"AI Project Builder."** AI generation is an enabling capability; the differentiated thesis is traceable project initialization and change-impact awareness.

Throughline is not intended to be:

- an autonomous coding agent
- a full application generator
- a deployment automation platform
- a replacement for GitHub
- a replacement for Jira
- a replacement for a designer
- a two-way synchronization platform
- an enterprise project-management suite

---

## 4. Business Context Reference

The business problem, target segments, stakeholder analysis, commercial risks, cost model, and success criteria are defined in **Throughline BRD v2.2**.

This document focuses on the software behavior required to deliver that business intent.

---

## 5. Project Constraints

The capstone implementation has the following fixed constraints:

- one developer
- eight full-time development days
- meaningful AI integration is required
- GitHub integration is mandatory
- Google Stitch integration is mandatory
- Jira integration is mandatory
- the system must demonstrate deterministic application logic in addition to AI generation
- the system must remain explainable during a live demo
- third-party integration failure must not destroy the entire workflow
- the implementation should preserve a realistic path toward a future product without attempting enterprise scope now

---

## 6. Primary User

### 6.1 MVP Actor

The MVP has one primary actor:

**Project Creator**

The Project Creator can:

- create a project
- submit the initial project brief
- review AI-generated artifacts
- approve or request revision
- select an architecture option
- preview external actions
- create a GitHub repository
- generate a UI prototype with Stitch
- approve a backlog
- create Jira issues
- revise previously approved artifacts
- review downstream impact warnings
- acknowledge warnings

### 6.2 Out of Scope Actors

The MVP does not implement:

- organization administrators
- multiple team roles
- approver vs editor roles
- complex RBAC
- external client accounts

---

## 7. High-Level Workflow

```text
PROJECT BRIEF
      |
      v
REQUIREMENTS + PROJECT CONTEXT
      |
      +--> Quality Check
      |
      +--> Human Approval
      |
      v
ARCHITECTURE
  - Option A
  - Option B
      |
      +--> Human selects one option
      +--> Human Approval
      |
      +---------------------> GITHUB INITIALIZATION
      |                        (non-blocking external output)
      |
      v
UI REQUIREMENTS
      |
      +--> Quality Check
      +--> Human Approval
      |
      +---------------------> STITCH UI PROTOTYPE
      |                        (leaf / external output)
      |
      v
BACKLOG
  - Epics
  - Stories
      |
      +--> Quality Check
      +--> Human Approval
      |
      v
JIRA CREATION
```

Versioning, item identity, lineage, approval history, staleness calculation, and external-reference tracking operate underneath the entire workflow.

---

## 8. Core Product Principles

The following principles are authoritative.

1. **Lineage before integrations.**
2. **Deterministic application state before AI autonomy.**
3. **AI proposes semantic meaning; application code owns identities and referential integrity.**
4. **Generation context is not the same as semantic dependency.**
5. **Exact item-version provenance matters.**
6. **Unchanged items are reused across artifact versions.**
7. **Staleness is computed from facts; it is not stored as permanent truth.**
8. **Drafts do not affect approved downstream work.**
9. **Only approved changes can supersede the current authoritative version.**
10. **Warnings must be specific, inspectable, and actionable.**
11. **Human approval remains authoritative.**
12. **External writes must be previewed and retry-safe.**
13. **Third-party failures must degrade gracefully.**
14. **P1 features are cut before weakening the lineage model.**

---

# PART A - FUNCTIONAL REQUIREMENTS

## 9. Project Creation and Brief

### FR-001 - Create Project

The user shall be able to create a new Throughline project.

Minimum project information:

- project name
- plain-language project brief

Optional context may include:

- team size
- team skills
- deadline
- budget constraints
- technology preferences
- expected scale

### FR-002 - Interpret Project Brief With AI

The system shall use an LLM to transform the plain-language brief into structured project context and Requirements.

The LLM may infer suggestions, but inferred assumptions must be visible rather than presented as confirmed facts.

---

## 10. Requirements + Project Context

There is no separate Project Profile approval phase.

The first primary artifact combines project context and Requirements.

### FR-010 - Generate Requirements Artifact

The system shall generate a Requirements artifact containing appropriate structured fields such as:

- business problem
- target users / actors
- expected scale
- deadline and delivery constraints
- team size and stated skills
- technology preferences
- budget constraints
- assumptions
- unresolved questions
- functional requirements
- non-functional requirements
- user journeys
- acceptance criteria

### FR-011 - Requirements Item Identity

Each requirement item shall have:

- a system-owned logical identity
- a system-owned item-version identity
- a human-readable display key such as `R-07`

The LLM shall not create canonical database identities.

### FR-012 - Requirements Quality Gate

Before approval, the system shall show deterministic quality checks where practical.

Examples:

- requirement missing acceptance criteria
- duplicate or invalid reference
- malformed item
- unresolved assumption
- required field missing

Optional AI-based semantic checks are P1.

### FR-013 - Approve or Revise Requirements

The user shall be able to:

- approve the Requirements artifact
- request revision with feedback

A revision creates a new ArtifactVersion and never overwrites an existing historical version.

---

## 11. Architecture

### FR-020 - Generate Two Architecture Options

Using the approved Requirements and Project Context, the AI shall generate exactly two architecture options for the MVP.

Each option shall explain project-specific trade-offs involving factors such as:

- scale
- team skills
- delivery deadline
- maintainability
- cost
- deployment complexity
- security constraints
- operational complexity

Generic technology comparison text without connection to the project context is not sufficient.

### FR-021 - Architecture Option Identity

Each architecture option shall have a stable option identifier inside its Architecture artifact version.

### FR-022 - Select and Approve One Architecture Option

An Architecture version cannot become authoritative unless exactly one option is selected.

The approval event shall record the selected option identifier.

Only decisions belonging to the selected architecture option become canonical lineage sources for GitHub initialization and downstream planning.

Unselected options remain historical alternatives but must not drive downstream lineage.

### FR-023 - Architecture Team-Skill Warning (P1)

This is a **P1** feature. If implemented, a deterministic warning may compare structured architecture `requiredSkills[]` with project `teamSkills[]`.

Correct wording:

> NestJS is required by this architecture but is not listed among the team's stated skills.

Incorrect wording:

> The team does not know NestJS.

Absence of a declared skill is not proof that the skill does not exist.

---

## 12. GitHub Repository Initialization

GitHub is mandatory in the MVP, but it is not a blocking dependency for later planning phases once Architecture is approved.

### FR-030 - GitHub Preview

Before any GitHub write, the system shall show a preview containing at least:

- repository name
- visibility if configurable
- repository initialization mode
- base template when used
- project-specific files or documentation to be added

### FR-031 - GitHub Initialization Modes

The system shall support two conceptual modes:

**Scaffold mode**

Used when the selected architecture matches the supported pinned starter/template closely enough for safe initialization.

**Docs-only mode**

Used when the selected architecture does not safely match the available starter. In this mode, Throughline may create a repository with decision documentation and lineage metadata without pretending it has scaffolded the selected stack.

The system must not silently create a mismatched codebase.

### FR-032 - Use One Pinned Starter for MVP

Throughline shall use one approved, pinned repository starter/template for scaffold mode.

The project shall not spend capstone time authoring a generic starter from scratch.

The selected starter's license must be checked before use.

### FR-033 - Add Architecture Rationale

Throughline shall add project-specific documentation such as:

- `README.md`
- Architecture Decision Records (ADRs)
- lineage metadata
- `.env.example` when useful
- simple CI configuration when easy and compatible with the starter

### FR-034 - ADR Provenance

ADRs shall cite the Throughline artifact versions that produced the approved architecture decision.

Example:

```yaml
architecture_version: ARCH-v2
requirements_version: REQ-v3
approved_at: 2026-09-20
```

### FR-035 - GitHub Is Self-Describing, Not Round-Trippable

The created repository shall preserve useful machine-readable lineage metadata.

The MVP shall not import GitHub metadata later to reconstruct Throughline database state.

### FR-036 - GitHub Change Warning

If the approved architecture changes after repository initialization, Throughline shall not automatically restructure the repository.

It shall display wording similar to:

> Architecture changed after repository initialization. The repository setup may no longer reflect the currently approved architecture. Manual review is required.

The user may acknowledge the warning.

---

## 13. UI Requirements

### FR-040 - Generate UI Requirements

From approved project planning artifacts, the AI shall generate structured UI Requirements containing appropriate fields such as:

- target users
- screens
- user flows
- navigation expectations
- key components
- responsive constraints
- accessibility constraints
- RTL/localization requirements
- UX priorities

### FR-041 - UI Requirements Approval

UI Requirements are a first-party planning artifact and require human approval.

The approved UI Requirements may be used by both:

- Backlog generation
- Stitch UI generation

---

## 14. Google Stitch Integration

Stitch is a leaf / external output. The Stitch visual result does not become a functional dependency of the Backlog.

### FR-050 - Stitch Prompt Preview

Before calling Stitch, Throughline shall show the generated structured UI prompt for review.

### FR-051 - Generate One UI Prototype

For the MVP, Throughline shall request one primary Stitch generation per approved UI Requirements version.

Multiple variants and iterative design editing are P1.

### FR-052 - Stitch Output Storage

Throughline shall persist the useful Stitch result rather than depend permanently on remote output URLs.

Preferred storage approach:

- metadata, checksum, and storage reference in the database
- HTML/screenshot bytes in file/object storage

### FR-053 - Safe HTML Preview

If generated HTML is displayed inside Throughline, it shall be sandboxed rather than injected directly into the application's main DOM.

### FR-054 - Stitch Fallback

If the Stitch API fails, Throughline shall preserve the generated Stitch-ready prompt and allow the workflow to continue in manual mode.

The artifact shall record a generation mode such as:

- `api`
- `manual`

Third-party failure must not invalidate the rest of the project.

---

## 15. Backlog

### FR-060 - Generate Epics and Stories

The AI shall generate an implementation backlog containing:

- Epics
- Stories

Tasks and Subtasks are out of scope for the MVP.

### FR-061 - Story Fields

A Story shall contain appropriate structured fields such as:

- stable logical identity
- item-version identity
- display key such as `S-12`
- title
- description
- acceptance criteria
- priority when needed
- source/dependency references

### FR-062 - Backlog Semantic Dependencies

The LLM may propose that a Story depends on specific upstream items such as:

- Requirement item versions
- Architecture Decision item versions
- UI Requirement item versions

Application code validates that the references exist and are structurally valid before persisting them.

Code validates referential integrity, not semantic truth.

### FR-063 - Backlog Quality Gate

P0 deterministic checks shall include inexpensive traceability checks such as:

- Story has no source Requirement
- Requirement has no implementation Story
- Story has no acceptance criteria
- source item does not exist
- source reference points to an invalid project/version

### FR-064 - Backlog Approval

The user must approve the Backlog before Jira creation.

Revision creates a new Backlog ArtifactVersion.

---

## 16. Jira Integration

Jira integration is mandatory but intentionally narrow.

### FR-070 - Jira Preview

Before writing to Jira, Throughline shall show what will be created.

Example:

```text
Project: THR
1 Epic
13 Stories
```

### FR-071 - Create Epics and Stories

The MVP shall create:

- Epics
- Stories

in one configured Jira project.

### FR-072 - One-Way Integration Only

The MVP shall not:

- synchronize Jira back into Throughline
- automatically update Jira issues after planning changes
- automatically delete Jira issues
- synchronize Jira workflow/status changes

### FR-073 - Store External References

After successful creation, Throughline shall store the mapping between the local source ItemVersion and external Jira issue.

Canonical provenance must use `sourceItemVersionId`, not only the human display key.

### FR-074 - Re-export Changed Story Behavior

If a logical Story already has a Jira issue created from an older ItemVersion and the Story changes, Throughline must not silently duplicate, update, or skip the issue.

The user shall see a choice similar to:

```text
S-12 changed since Jira issue THR-42 was created.

Existing Jira issue: THR-42
Created from: S-12 v1
Current: S-12 v2

[Skip]
[Create New Jira Issue]
```

Updating the existing Jira issue is out of scope for the MVP.

---

# PART B - VERSIONING, IDENTITY, AND LINEAGE

## 17. Artifact Model

A project contains first-party Artifacts such as:

- Requirements
- Architecture
- UI Requirements
- Backlog

Each Artifact has multiple ArtifactVersions over time.

Suggested version statuses:

- `draft`
- `approved`
- `superseded`
- `rejected`

---

## 18. Approval Workflow Invariants

### INV-001 - One Authoritative Approved Version

For an Artifact, one approved version is authoritative at a time.

### INV-002 - Drafts Do Not Trigger Impact

A draft version does not affect approved downstream lineage.

Example:

```text
Requirements v2 APPROVED
Requirements v3 DRAFT
```

Requirements v2 remains authoritative until v3 is approved.

### INV-003 - Rejected Drafts Never Supersede

If Requirements v3 is rejected, Requirements v2 remains authoritative.

### INV-004 - Approval Supersedes Transactionally

When a new version is approved:

1. the new version becomes approved
2. the previous authoritative approved version becomes superseded

These state changes shall happen transactionally so the system does not temporarily expose two authoritative versions or no authoritative version.

### INV-005 - One Active Draft Per Artifact

The MVP shall allow at most one active draft for a given Artifact.

If regeneration occurs before the current draft is accepted, the older pending draft is preserved historically but becomes inactive/replaced.

Implementation may use an existing status plus a system reason rather than adding unnecessary public statuses.

---

## 19. Logical Items and Item Versions

Throughline must distinguish the idea of an item from a historical version of that item.

Example:

```text
LogicalItem: Authentication Requirement
Display key: R-07

ItemVersion A:
Email/password authentication

ItemVersion B:
Google + Microsoft SSO
```

Both historical versions represent the same logical Requirement, but their content differs.

Each item therefore needs at least:

- `logicalItemId`
- `itemVersionId`
- human-readable `displayKey`

The display key is useful for humans but is not the canonical database identity.

---

## 20. ArtifactVersion-Item Membership

An ItemVersion does not belong exclusively to one ArtifactVersion.

Unchanged items may be reused by reference across multiple ArtifactVersions.

Example:

```text
Requirements v2
|-- R-01 @ ItemVersion-A
|-- R-07 @ ItemVersion-B
`-- R-15 @ ItemVersion-C

Requirements v3
|-- R-01 @ ItemVersion-A   unchanged / reused
|-- R-07 @ ItemVersion-D   modified / new ItemVersion
`-- R-15 @ ItemVersion-C   unchanged / reused
```

Therefore the data model requires a membership relationship conceptually similar to:

`ArtifactVersionItemMembership`

with fields such as:

- artifactVersionId
- itemVersionId
- position/order if required

This is fundamentally many-to-many.

---

## 21. New, Modified, Unchanged, and Removed Items

### INV-010 - Unchanged Item

If an item is meaningfully unchanged, the existing ItemVersion shall be reused in the new ArtifactVersion membership.

### INV-011 - Modified Item

If an existing logical item changes meaningfully:

- preserve its `logicalItemId`
- create a new `itemVersionId`

### INV-012 - New Item

If an item did not exist before:

- create a new `logicalItemId`
- create a new `itemVersionId`

### INV-013 - Removed Item

If an item exists in the current authoritative approved ArtifactVersion used as the generation base but is absent from the newly approved version, it is considered removed.

The generation base shall be the authoritative approved version at the time the new draft is created - never a rejected or inactive draft. For the MVP, removal may be derived by comparing memberships between that approved base version and the new approved version rather than requiring a separate tombstone table.

Removed items shall be valid starting points for downstream impact traversal.

---

## 22. Meaningful Equality and Semantic Hashing

Raw text equality is too strict because an LLM may rephrase content without changing its meaning.

Blindly trusting the LLM's `unchanged` label is too weak because a meaningful change may be missed.

The MVP shall use **artifact/item-type-specific semantic projections**.

A semantic projection includes only fields considered meaningful for that item type, then code canonicalizes and hashes the structure.

Conceptual example:

```text
semanticHash = SHA-256(canonicalJSON(semanticProjection(item)))
```

Example fields:

| Item type | Example semantic fields |
|---|---|
| Requirement | type, actor, behavior, constraints, acceptance criteria |
| Architecture Decision | decision, technology/approach, constraints, major trade-offs |
| UI Requirement | screen/flow, interaction requirement, responsive/accessibility constraints |
| Story | user/value statement, source references, acceptance criteria |

Fields such as formatting, generated explanation text, timestamps, or display-only metadata shall not affect semantic equality unless they carry real project meaning.

The LLM's proposed unchanged/modified classification is a hint. Code-owned structural comparison decides whether the previous ItemVersion is reused.

---

## 23. Generation Context vs Semantic Dependency

Throughline must store these concepts separately.

### 23.1 Generation Context

`generationContextRefs`

Meaning:

> These approved artifacts/items were available to the AI while generating this artifact.

For the MVP, generation context can be stored at ArtifactVersion level.

Generation context is used for:

- auditability
- debugging
- reproducibility

Generation context does **not** automatically mean semantic dependency.

### 23.2 Semantic Dependency

`dependencyRefs`

Meaning:

> This specific downstream ItemVersion semantically depends on these specific upstream ItemVersions.

Example:

```text
Story S-12
depends on:
- Requirement R-07 @ Requirements v3
- ADR-03 @ Architecture v2
```

The AI may propose semantic mappings.

Application code shall validate:

- the referenced item exists
- the referenced ItemVersion exists
- the project is correct
- the reference satisfies schema rules

Application code cannot prove the semantic relationship is logically true; it can enforce structural integrity.

---

## 24. Item Matching During Regeneration

The application owns item identities.

When an artifact is regenerated, the comparison base shall be the current authoritative approved ArtifactVersion captured when the new draft is created. Rejected or inactive drafts shall not become the base.

1. Existing items and their identifiers from that approved base are supplied to the model.
2. The model may propose which previous logical item a new output corresponds to.
3. Code validates that proposed previous identity exists.
4. Code computes the artifact-type-specific semantic comparison.
5. If meaningfully unchanged, reuse the old ItemVersion.
6. If meaningfully modified, create a new ItemVersion under the same LogicalItem.
7. If new, create a new LogicalItem and ItemVersion.

The model must not invent trusted canonical identifiers.

---

## 25. Change Impact and Staleness

### INV-020 - Staleness Is Computed on Read

Throughline shall not store a permanent canonical `isStale` field.

Impact state is computed from:

- approved/superseded versions
- changed or removed ItemVersions
- semantic dependency relationships
- external references
- warning acknowledgements

### INV-021 - Traversal Starts From Changed or Removed Items

Approving a new ArtifactVersion does not automatically make every downstream item stale.

Traversal begins from the specific ItemVersions that changed or were removed.

### INV-022 - Direct vs Transitive Impact

Throughline shall distinguish:

- **Direct impact:** the item directly depends on a changed/removed source ItemVersion
- **Transitive impact:** the item depends on another impacted item through one or more dependency edges

The system shall support transitive traversal for P0 and shall not flatten all impact into one undifferentiated list.

### INV-023 - Inspectable Impact Path

For P0 lineage warnings, the user shall be able to inspect the dependency path that explains why an item is flagged.

Example:

```text
R-07 changed
  -> ADR-03 directly depends on R-07
  -> S-12 depends on ADR-03
  -> Jira THR-42 was created from S-12
```

### INV-024 - Conservative Language

Warnings shall use conservative wording such as:

- potentially affected
- review recommended
- based on a superseded source
- may no longer be consistent

Throughline shall not claim an item is incorrect unless that conclusion is actually known.

---

## 26. Warning Acknowledgements

The user may acknowledge an impact warning.

Acknowledgement must be specific to both:

- the affected subject
- the triggering change

Conceptual fields:

- subjectVersionId
- subjectItemVersionId if applicable
- causeVersionId
- causeItemVersionId if applicable
- acknowledgedAt
- note

Example:

S-12 acknowledges impact caused by:

`R-07 v2 -> R-07 v3`

If R-11 later changes, the earlier acknowledgement must not suppress the new warning.

---

## 27. Dependency Visualization

Throughline shall provide a simple dependency/version view.

This is a demo and comprehension feature, not a graph-editing product.

Do not build a complex interactive DAG editor for P0.

Example:

```text
Requirements v3     CURRENT

Requirements v2     SUPERSEDED
      |
      v
Architecture v1     REVIEW
      |
      v
Backlog v3          REVIEW
      |
      v
THR-42              REVIEW
```

The visualization must use the same dependency data and traversal rules as the warning engine.

It must not contain an independent implementation of staleness logic.

---

# PART C - EXTERNAL INTEGRATIONS AND FAILURE BEHAVIOR

## 28. External Reference Model

An external object created from Throughline shall preserve its local provenance.

Conceptually, `ExternalRef` contains:

- provider
- externalId
- sourceVersionId when relevant
- canonical `sourceItemVersionId` when created from an item
- optional display key for convenience

The human-readable key is not the canonical provenance foreign key.

---

## 29. External Operation Tracking

Before an external write, Throughline shall create a local operation record.

Conceptual fields:

- operationKey
- provider
- status
- request fingerprint/hash
- external IDs when known
- timestamps
- error/reconciliation information

Possible states may include:

- pending
- completed
- failed
- reconciliation_required

---

## 30. Retry Safety and Reconciliation

A local operation table alone is not enough for true retry safety.

Dangerous example:

```text
Throughline sends Jira create request
Jira creates the issue
network response is lost
Throughline does not know the Jira key
user retries
duplicate Jira issue is created
```

Therefore P0 requires a reconciliation strategy after ambiguous failures.

### 30.1 GitHub Reconciliation

GitHub repository creation can use a deterministic owner/repository name.

After an ambiguous failure:

1. query GitHub for the expected repository
2. if it exists, reconcile the local ExternalRef
3. if it does not exist, allow retry

### 30.2 Jira Reconciliation

For Jira creation, Throughline shall use a deterministic Throughline source marker, or an equivalent queryable reconciliation mechanism, in the configured Jira project.

After an ambiguous failure:

1. search Jira for the Throughline source marker
2. if an issue exists, reconcile the local ExternalRef
3. if no issue exists, allow retry

The exact Jira marker mechanism must be validated during the technical integration spike.

The MVP does not require an enterprise distributed transaction architecture, but it must not claim writes are safe if ambiguous failures can silently duplicate objects.

---

## 31. External Integration Failure Rules

External services shall not own Throughline's internal project truth.

Failure of GitHub, Stitch, or Jira shall:

- preserve first-party artifact state
- record the external operation failure
- give the user a clear retry/reconciliation path where appropriate
- avoid corrupting lineage

Stitch additionally supports manual fallback using the generated prompt.

---

# PART D - QUALITY, AI, AND NON-FUNCTIONAL REQUIREMENTS

## 32. AI Responsibility Boundary

### AI May

- interpret project briefs
- extract structured project context
- generate Requirements
- generate user journeys and acceptance criteria
- propose architecture options
- explain architecture trade-offs
- generate UI Requirements
- generate Backlog Epics and Stories
- propose semantic dependency mappings
- generate README/ADR prose
- suggest revisions
- optionally provide semantic quality critique
- optionally explain change impact

### AI Must Not Own

- canonical IDs
- workflow state
- approval state
- version state
- referential integrity
- stale-state truth
- graph traversal
- external-operation state
- idempotency/reconciliation state

---

## 33. Structured AI Output

AI-generated outputs shall use structured schemas rather than unvalidated free-form prose wherever the application depends on them.

Every artifact payload shall include a `schemaVersion`.

The application shall validate structured output before accepting it into workflow state.

---

## 34. Quality Checks vs Capstone Evaluation

These are different concepts.

### In-Product Quality Checks

These help users inspect an artifact before approval.

Examples:

- missing acceptance criteria
- invalid references
- Requirement without Story

### Capstone Evaluation

This measures whether Throughline improves the project-initialization process compared with a manual baseline.

Quality checks are a product feature.

Evaluation is project/research work.

---

## 35. Non-Functional Requirements

### NFR-001 - Explainability

Users shall be able to understand why a downstream item is flagged when a dependency path exists.

### NFR-002 - Data Integrity

Application code shall enforce referential integrity and prevent invalid cross-project references.

### NFR-003 - History Preservation

Historical approved/rejected/superseded versions shall not be silently overwritten.

### NFR-004 - Reproducibility Metadata

Where practical, generated ArtifactVersions should record:

- AI provider
- model
- input token count
- output token count
- latency
- generation timestamp

### NFR-005 - Security

- API credentials shall remain server-side.
- Secrets shall not be stored in generated repositories.
- Generated HTML shall be sandboxed for preview.
- External writes shall require explicit user action after preview.
- The hosted capstone instance shall be protected by at least a basic access gate (for example, authenticated/allowlisted access) so an unknown public visitor cannot use stored GitHub, Jira, Stitch, or LLM credentials to trigger external actions or spend API budget.

### NFR-006 - Reliability

Third-party API failure shall not corrupt first-party artifact/version/lineage data.

### NFR-007 - Performance

For the MVP data size, dependency traversal and impact display should feel interactive to the user.

The system does not need enterprise-scale graph optimization in the capstone.

### NFR-008 - Simplicity

The implementation should favor straightforward, inspectable logic over generalized infrastructure that is not needed for the 8-day build.

---

# PART E - P0 / P1 SCOPE

## 36. P0 - Must Work

P0 is the minimum acceptable capstone.

### Core Data and Workflow

- Project creation and project brief
- Artifact model
- ArtifactVersion model
- `schemaVersion`
- LogicalItem model
- ItemVersion model
- ArtifactVersionItemMembership
- human-readable item keys
- one active draft per Artifact
- approval/revision workflow
- ApprovalEvent log
- immutable history
- selected Architecture option

### Lineage

- Artifact-level generation context references
- item-level semantic dependency references
- validation of references
- reuse of unchanged ItemVersions
- changed/removed item detection
- direct impact traversal
- transitive impact traversal
- inspectable impact path
- computed review/stale warnings
- warning acknowledgement tied to the triggering change

### AI

- Requirements + Project Context generation
- exactly two Architecture options
- UI Requirements generation
- Backlog Epics + Stories
- structured schemas for model output

### Quality

- Requirements deterministic quality gate
- Backlog deterministic traceability quality gate

### GitHub

- preview
- one pinned starter for scaffold mode
- docs-only fallback/mode when architecture does not fit the starter
- repository creation
- README customization
- ADR generation
- lineage metadata
- retry/reconciliation handling

### Stitch

- UI prompt preview
- one generation per approved UI Requirements version
- persisted useful output
- sandboxed HTML preview when used
- manual fallback mode

### Jira

- preview
- one configured project
- Epics and Stories
- ExternalRef mapping by ItemVersion
- changed-Story re-export choice: Skip vs Create New
- retry/reconciliation handling

### Visualization

- simple dependency/version view
- status badges
- same traversal logic as warnings

---

## 37. P1 - Droppable Without Breaking the Thesis

If development is behind schedule, remove or simplify these before cutting P0 lineage behavior:

- AI-written change-impact explanation
- advanced visual polish
- Architecture semantic Quality Checks
- FR-023 deterministic Architecture team-skill warning
- AI architecture-quality critique
- Stitch variants
- Stitch iterative editing
- multiple GitHub templates
- multiple Jira configurations
- interactive graph editing
- sophisticated semantic quality scoring
- generalized multiple-AI-provider support
- elaborate external metadata beyond what supports traceability

---

## 38. Explicitly Out of Scope

The MVP shall not implement:

- autonomous coding
- full application source-code generation
- generated-project deployment automation
- Vercel deployment automation for generated projects
- Figma integration
- multi-agent coding systems
- GitHub PR automation
- GitHub branch monitoring
- automatic repository restructuring
- repository migration
- codebase analysis
- two-way Jira synchronization
- automatic Jira issue updates
- automatic Jira deletion synchronization
- multi-user organizations
- complex RBAC
- enterprise-scale permissions
- GitHub-to-Throughline round-trip import
- arbitrary repository-template generation
- enterprise workflow customization

---

# PART F - DEMO AND ACCEPTANCE CONTEXT

## 39. Primary Demo Scenario

A successful demonstration should support a scenario similar to the following.

### Step 1 - Brief

User enters:

> Build an e-commerce application for selling sofa covers.

### Step 2 - Requirements

AI generates structured project context and Requirements.

User reviews Quality Checks and approves.

### Step 3 - Architecture

AI produces two architecture options.

User selects and approves one option.

### Step 4 - GitHub

Throughline previews and initializes a GitHub repository in the appropriate mode.

It adds project-specific README, ADR, and lineage metadata.

### Step 5 - UI Requirements + Stitch

Throughline generates UI Requirements.

User approves them.

Throughline previews the Stitch prompt and generates one UI prototype, or falls back to manual mode if necessary.

### Step 6 - Backlog

AI generates Epics and Stories with item-level source references.

Throughline performs deterministic traceability checks.

User approves the Backlog.

### Step 7 - Jira

Throughline previews Jira creation and creates Epics/Stories.

ExternalRefs are stored.

### Step 8 - Upstream Change

User revises one approved Requirement, for example:

Before:

> Users authenticate using email/password.

After:

> Users authenticate using Google and Microsoft SSO.

The new Requirements version is approved.

Throughline should:

- reuse all meaningfully unchanged Requirement ItemVersions
- create a new ItemVersion only for the modified Requirement
- supersede the old Requirements version only after approval
- begin traversal from the changed Requirement ItemVersion
- identify directly and transitively affected downstream items
- explain the dependency path
- show affected Jira issues without modifying them automatically

The system shall not claim unaffected work is stale simply because the parent Requirements artifact received a new version.

---

## 40. Business and Capstone Evaluation Reference

The business case, business risks, segment-fit limitations, cost assumptions, formal manual-baseline evaluation design, metrics, controlled change test, success criteria, and evaluation limitations are defined in **Throughline BRD v2.2**.

This technical document defines the system behavior and technical acceptance criteria required to support that evaluation. Passing these technical criteria does not by itself prove market demand, product-market fit, or superiority over the manual baseline.

---

# PART G - DEVELOPMENT ORDER AND TECHNICAL SPIKES

## 41. Recommended Build Order

The dependency/lineage system must be implemented before spending most of the schedule on integrations.

Recommended order:

1. Project + Artifact
2. ArtifactVersion
3. LogicalItem
4. ItemVersion
5. ArtifactVersionItemMembership
6. Approval/revision workflow
7. Architecture selected-option rule
8. Item matching and semantic hashes
9. Item dependency relationships
10. changed/removed item detection
11. direct/transitive traversal
12. computed warning behavior
13. acknowledgement behavior
14. Requirements generation
15. Architecture generation
16. GitHub integration
17. UI Requirements
18. Stitch integration
19. Backlog generation
20. Jira integration
21. dependency visualization and polish
22. evaluation

If time becomes tight, P1 features are removed before simplifying the P0 lineage model.

---

## 42. Early Technical Spikes

Before building polished screens, verify risky boundaries.

### Spike A - Structured LLM Output

Prove:

```text
LLM -> structured JSON -> schema validation -> persisted ArtifactVersion
```

### Spike B - Stitch

Prove:

```text
approved UI prompt -> Stitch generation -> persist screenshot/HTML or fallback prompt
```

### Spike C - GitHub + Jira Retry/Reconciliation

For GitHub:

```text
create -> simulate ambiguous/lost response -> query deterministic repo -> reconcile
```

For Jira:

```text
create test issue with Throughline marker -> simulate ambiguous response -> search marker -> reconcile
```

These spikes should happen early enough that integration limitations do not appear for the first time near demo day.

---

## 43. Deployment of Throughline Itself

Deployment of generated customer projects is out of scope.

However, Throughline itself should be deployed to a hosted environment early in development.

The purpose is to expose problems involving:

- environment variables
- database connectivity
- authentication if present
- provider credentials
- browser/server differences
- third-party API behavior

The first hosted deployment should not be left until demo day.

---

# PART H - ACCEPTANCE CRITERIA FOR THE CAPSTONE

## 44. P0 Acceptance Criteria

The capstone is considered functionally successful when all of the following core behaviors work in a demo environment:

1. A user can create a project from a plain-language brief.
2. AI can generate structured Requirements + Project Context.
3. The Requirements artifact can be revised without overwriting history.
4. Unchanged Requirement items are reused across versions.
5. Modified Requirement items create new ItemVersions under the same LogicalItem.
6. Draft Requirements do not trigger downstream warnings.
7. Approving a new Requirements version supersedes the previous authoritative version.
8. AI generates exactly two Architecture options.
9. The user selects exactly one Architecture option before approval.
10. Only the selected Architecture option becomes canonical downstream lineage.
11. GitHub initialization can be previewed and executed in scaffold or docs-only mode as appropriate.
12. GitHub receives project-specific architecture rationale and lineage metadata.
13. UI Requirements can be generated and approved.
14. Stitch generation can run or degrade to manual prompt mode without breaking the planning workflow.
15. AI generates Backlog Epics and Stories with source references.
16. Deterministic Backlog traceability checks can find simple coverage/reference gaps.
17. Approved Backlog items can be previewed and created in one Jira project.
18. Jira ExternalRefs point canonically to the exact local ItemVersion.
19. Ambiguous external-write failures have a reconciliation path before retry.
20. Changing one approved upstream item flags only the downstream dependency chain affected by that changed/removed ItemVersion.
21. Direct and transitive impact can be distinguished.
22. The dependency view is generated from the same lineage data used by the warning engine.
23. The user can acknowledge a warning without suppressing unrelated future warnings.
24. No automatic Jira update, repository restructuring, code generation, or deployment occurs.

---

# APPENDIX A - AUTHORITATIVE INVARIANTS FOR DEVELOPERS AND AI AGENTS

These rules must not be silently changed during implementation.

1. The LLM does not own canonical IDs.
2. Display keys such as `R-07` and `S-12` are not database identity.
3. LogicalItem and ItemVersion are separate concepts.
4. ArtifactVersion and ItemVersion are connected through membership, not exclusive ownership.
5. Unchanged items reuse existing ItemVersions.
6. Modified items preserve LogicalItem identity and receive new ItemVersions.
7. Removed items are derived from membership differences in the MVP.
8. Meaningful equality is determined by code-owned, item-type-specific semantic projections/hashes.
9. The model's unchanged/modified label is only a hint.
10. Generation context and semantic dependency are separate concepts.
11. Generation context is ArtifactVersion-level in the MVP.
12. Semantic dependencies are ItemVersion-level.
13. Draft or rejected versions never activate impact warnings.
14. Approval is what supersedes the previous authoritative ArtifactVersion.
15. Impact traversal starts from changed/removed ItemVersions, not merely a superseded parent artifact.
16. Traversal may be transitive, but the UI distinguishes direct from transitive impact.
17. Staleness/review status is computed rather than stored as canonical truth.
18. Warning acknowledgements are scoped to a specific subject and cause.
19. Architecture approval requires exactly one selected option.
20. GitHub is a non-blocking external output of approved Architecture.
21. GitHub initialization supports `scaffold` and `docs-only` behavior so a mismatched starter is never silently created.
22. UI Requirements are first-party; Stitch visual output is a leaf.
23. Backlog does not depend on the Stitch visual result.
24. Jira is one-way in the MVP.
25. Changed Story re-export never silently updates or duplicates an existing Jira issue.
26. `ExternalRef.sourceItemVersionId` is the canonical item provenance pointer.
27. External write operations require local tracking plus reconciliation after ambiguous failures.
28. Third-party failure never corrupts first-party artifact history or lineage.
29. Requirements and Backlog deterministic quality checks remain P0.
30. AI semantic change-impact prose is optional P1.
31. One active draft per Artifact is allowed in the MVP.
32. The project prioritizes lineage correctness over integration breadth or visual polish.

---

# APPENDIX B - GUIDANCE FOR AI CODING AGENTS

When using this file as development context:

- Treat this technical requirements document, together with Throughline BRD v2.2, as the current authoritative product baseline.
- Do not reopen previously rejected features unless a concrete blocker requires it.
- Do not introduce two-way synchronization.
- Do not introduce autonomous code generation.
- Do not make Stitch output a Backlog dependency.
- Do not clone every item merely because an ArtifactVersion changed.
- Do not store a permanent `isStale` truth field.
- Do not let draft versions trigger impact warnings.
- Do not allow an Architecture version to become authoritative without one selected option.
- Do not use display keys as canonical foreign keys.
- Do not assume an external write failed merely because its response was lost; reconcile first.
- Prefer simple, explicit data structures that preserve the invariants above.
- If implementation pressure occurs, remove P1 features before weakening lineage behavior.
- If a requested implementation contradicts this technical requirements document, identify the contradiction before proceeding.

Recommended next development documents:

1. ERD / Data Model
2. Module boundaries
3. API contracts
4. Jira implementation plan
5. Day-by-day implementation plan

---

**End of Technical Requirements & Lineage Invariants**

---

## 45. Business-to-Technical Traceability

This matrix connects the business requirements in **Throughline BRD v2.2** to the technical requirements and invariants in this document. It is intentionally high-level; the ERD and API contracts will provide the next level of implementation traceability.

| Business Requirement | Technical realization |
|---|---|
| **BR-001** - Structured project-initialization workflow | FR-001, FR-002, FR-010, FR-020, FR-040, FR-060; Sections 7, 9-15 |
| **BR-002** - Human approval controls authoritative state | FR-013, FR-022, FR-041, FR-064; INV-001 through INV-005 |
| **BR-003** - Exact approved-source lineage | FR-011, FR-034, FR-062, FR-073; Sections 19-24 and 28 |
| **BR-004** - Specific direct/transitive change impact with inspectable reason | INV-013, INV-020 through INV-024; Sections 25-27 |
| **BR-005** - Honest GitHub initialization from approved architecture | FR-030 through FR-036; Sections 12, 29-31 |
| **BR-006** - Stitch generation from approved UI Requirements without controlling backlog lineage | FR-040, FR-041, FR-050 through FR-054; Sections 13-14 |
| **BR-007** - Preview/create Jira Epics and Stories with exact local provenance | FR-070 through FR-074; Sections 16 and 28-30 |
| **BR-008** - Explicit, previewed, retry-aware external writes | FR-030, FR-050, FR-070; Sections 29-31 |
| **BR-009** - AI for semantic work; deterministic code for state and integrity | Sections 23-24 and 32-33; all approval/lineage invariants |
| **BR-010** - Protect core lineage when scope pressure occurs | Sections 36-38 and 41-44 |

### 45.1 Traceability Rule for Later Artifacts

The next project artifacts shall preserve this chain where practical:

```text
Business Objective (BO)
        -> Business Requirement (BR)
        -> Functional Requirement / Invariant (FR / INV)
        -> Data Model / API / Module
        -> Jira implementation ticket
        -> Verification / evaluation evidence
```

The ERD shall not invent entities that contradict this technical baseline. If an implementation need appears to require such a contradiction, the requirement or invariant must be revisited explicitly first.

