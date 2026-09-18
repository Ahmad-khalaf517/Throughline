# Throughline - Business Requirements Document (BRD)

**Document version:** 2.2  
**Project:** Throughline  
**Project type:** AI-assisted software project initialization and traceability platform  
**Delivery context:** Solo capstone project, 8 full-time development days  
**Status:** Business baseline for Technical Requirements -> ERD/Data Model -> Modules -> API Contracts -> Jira Plan -> Implementation  
**Primary audience:** Instructor/mentor, project reviewer, developer, and future product stakeholders

---

## 1. Executive Summary

Throughline is an AI-assisted platform that helps a developer or small software team move from an initial project brief to structured requirements, an approved architecture direction, a GitHub engineering workspace, UI requirements and prototype, and an executable Jira backlog.

The main value is not simply that AI can generate documents. Throughline preserves **traceability** between important project decisions and downstream work. If an approved requirement or architecture decision changes later, the system can identify the specific dependent items that may need review instead of broadly declaring the whole project outdated.

For the capstone, Throughline integrates AI, GitHub, Google Stitch, and Jira while keeping critical workflow state, approval, versioning, and lineage deterministic and human-controlled.

**Positioning:**

> From brief to repo and backlog, with every artifact traceable to the decision it came from.

Throughline should not be positioned primarily as an "AI Project Builder." AI generation is important, but the stronger product idea is **AI-assisted project initialization with decision lineage and change-impact awareness**.

---

## 2. Business Problem

Software project initialization is often fragmented across chat messages, documents, architecture notes, design tools, GitHub, and Jira. Teams may create useful requirements and planning artifacts at the start, but once implementation begins, the connection between those decisions and the actual work is often lost.

This creates four practical problems:

1. **Planning artifacts become disconnected from execution.** A requirement may lead to architecture decisions and Jira stories, but the relationship is rarely preserved explicitly.
2. **Changes are difficult to assess.** When an approved requirement changes, teams often rely on memory to determine which technical decisions or backlog items need review.
3. **AI-generated planning can create false confidence.** Generated documents can look complete while still lacking reliable provenance, approval history, and change control.
4. **Project setup is repetitive.** Developers repeatedly move the same information between planning documents, repository setup, UI design prompts, and backlog tools.

Throughline addresses these problems by combining AI-assisted planning with human approval, immutable versions, item-level lineage, and controlled handoff to development tools.

---

## 3. Business Objectives

| ID | Objective | Why it matters | How it will be judged in the capstone |
|---|---|---|---|
| **BO-001** | Reduce repetitive project-initialization work | Developers spend time rewriting the same context across requirements, architecture, UI, GitHub, and Jira | Compare completion time against a manual baseline for three sample briefs |
| **BO-002** | Improve planning consistency | AI output is more useful when downstream work remains connected to approved decisions | Reviewer checklist for completeness, acceptance criteria, backlog coverage, and unresolved assumptions |
| **BO-003** | Preserve traceability | Teams need to know why a story, ADR, or external issue exists | Approved backlog items should retain valid source lineage to exact upstream item versions |
| **BO-004** | Make change impact actionable | Broad "everything is stale" warnings are not useful | Controlled change tests should identify specific affected items and avoid unnecessary warnings |
| **BO-005** | Keep humans in control | AI should assist decisions, not silently change project state | Major first-party artifacts require explicit approval; external writes require preview and explicit action |
| **BO-006** | Demonstrate meaningful AI integration | The capstone must use AI for reasoning, not only a chatbot | AI generates and interprets structured project artifacts while deterministic code controls identity, state, and integrity |

### 3.1 Business Traceability

Throughline applies the same traceability principle to its own documentation. Business objectives define the outcomes the project is trying to achieve; business requirements state what the product must do to support those outcomes; the Technical Requirements & Lineage Invariants document then translates those business requirements into detailed implementation behavior.

**Traceability chain:** Business Objectives (`BO-xxx`) -> Business Requirements (`BR-xxx`) -> Technical Requirements / Invariants (`FR-xxx`, `NFR-xxx`, `INV-xxx`) -> Implementation -> Capstone Evaluation.

---

## 4. Stakeholders

| Stakeholder | Interest / Need | Influence on MVP |
|---|---|---|
| **Project Creator / Developer** | Faster setup, clear planning, traceability, useful GitHub/Jira outputs | High - primary user |
| **Instructor / Mentor** | Evidence of meaningful AI integration, sound engineering, realistic scope, measurable evaluation | High - capstone reviewer |
| **Future Small Team / Agency User** | Repeatable project initialization, standardized decisions, less coordination loss | Medium - future product audience |
| **Future Platform/Engineering Lead** | Decision history, architecture rationale, traceability across project tools | Medium - future product audience |
| **GitHub, Stitch, Jira, LLM providers** | External capabilities used by Throughline | External dependency, not a business stakeholder |

The MVP has one product actor: **Project Creator**. Multi-user teams, role-based approvals, organization accounts, and complex permissions are outside the capstone scope.

---

## 5. Target Segments and Market Fit

Two potential user segments have been considered.

| Segment | Potential value | Main weakness |
|---|---|---|
| **Individual developers / small teams** | Faster setup, better structured planning, direct handoff to familiar tools | Low usage frequency; they may initialize only a few projects per year and can use general-purpose AI for simple document generation |
| **Agencies / platform teams / software consultancies** | Repeatable initialization across many projects, common standards, traceability, reusable process | Requires stronger team features, templates, permissions, and integrations in a future product |

For the capstone, the workflow is designed around a single developer. For a real product, agencies or teams that initialize many projects are likely a stronger long-term segment because they experience the problem more frequently.

This capstone does **not** claim product-market fit. It validates the mechanism and technical workflow.

---

## 6. Proposed Product Experience

The intended MVP journey is:

```text
Project Brief
    |
    v
Requirements + Project Context
    |
    v
Architecture - 2 options, 1 selected
    |
    +----> GitHub repository / architecture documentation
    |
    v
UI Requirements
    |
    +----> Google Stitch UI prototype
    |
    v
Backlog - Epics + Stories
    |
    v
Jira issues
```

Under this workflow, Throughline preserves:

- human approval and revision history
- immutable artifact versions
- item-level source relationships
- exact version provenance
- change-impact warnings when an approved upstream item changes
- external references to GitHub/Jira outputs

GitHub, Stitch, and Jira are useful outputs of the planning process. They do not replace Throughline's internal history or become the authoritative source for its lineage model.

---

## 7. Business Requirements

| ID | Business Requirement | Serves |
|---|---|---|
| **BR-001** | Throughline shall transform a plain-language project brief into a structured workflow covering Requirements, Architecture, UI Requirements, and Backlog. | BO-001, BO-002 |
| **BR-002** | Throughline shall require explicit human approval before major first-party planning artifacts become authoritative. AI shall not silently advance or modify authoritative project state. | BO-005 |
| **BR-003** | Throughline shall preserve enough lineage to trace approved downstream work back to the exact approved upstream item versions that informed it. | BO-003 |
| **BR-004** | When an approved upstream item is changed or removed, Throughline shall identify the specific directly and transitively dependent work that may require review and shall provide an inspectable reason/path. | BO-003, BO-004 |
| **BR-005** | Throughline shall be able to create a GitHub repository or documentation-only repository output from the approved architecture without pretending to scaffold an unsupported architecture. | BO-001, BO-003 |
| **BR-006** | Throughline shall convert approved UI Requirements into a structured Google Stitch generation request while keeping the Stitch visual output non-authoritative for functional backlog lineage. | BO-001, BO-003 |
| **BR-007** | Throughline shall be able to preview and create approved Epics and Stories in one configured Jira project while preserving the exact local source item version for each created issue. | BO-001, BO-003 |
| **BR-008** | External writes shall be explicit, previewed, retry-aware, and recoverable after ambiguous failures where practical. Third-party failures shall not corrupt internal project history. | BO-005 |
| **BR-009** | AI shall be used for interpretation, generation, trade-off reasoning, and semantic mapping. Deterministic code shall own identifiers, validation, workflow state, approvals, lineage storage, traversal, and external-operation state. | BO-002, BO-006 |
| **BR-010** | When scope pressure occurs, optional AI commentary and advanced polish shall be removed before weakening the core lineage, approval, versioning, or traceability behavior. | BO-005, BO-006 |

---

## 8. MVP Scope (P0)

The capstone MVP must demonstrate the following end-to-end capabilities:

- create a project from a plain-language brief
- generate Requirements + Project Context with AI
- review, revise, and approve Requirements
- generate exactly two architecture options and approve one selected option
- create a GitHub output using one pinned starter when compatible, with a docs-only mode when it is not
- add README/ADR/lineage documentation to the GitHub output
- generate and approve structured UI Requirements
- generate one Stitch UI prototype or degrade gracefully to a saved Stitch-ready prompt
- generate Backlog Epics and Stories with source references
- run deterministic Requirements and Backlog quality checks
- preview and create approved Epics and Stories in one Jira project
- preserve immutable versions and item-level lineage
- reuse unchanged item versions instead of copying them unnecessarily
- detect changed/removed upstream items only after the new artifact version is approved
- show direct/transitive impact and an inspectable dependency path
- provide a simple dependency/version visualization
- protect external writes against ordinary duplicate/retry behavior and reconcile ambiguous failures where supported

---

## 9. Explicitly Out of Scope

The MVP will not implement:

- autonomous application coding
- full source-code generation
- deployment of generated customer projects
- Vercel deployment automation for generated projects
- Figma integration
- multiple autonomous agents
- GitHub pull-request or branch automation
- automatic repository restructuring or migration
- codebase analysis
- two-way Jira synchronization
- automatic Jira issue updates or deletion synchronization
- multi-user organizations
- complex role-based permissions
- enterprise workflow customization
- GitHub-to-Throughline round-trip reconstruction
- multiple generalized AI providers

These exclusions are deliberate to protect the 8-day scope and keep the core thesis deep enough to demonstrate correctly.

---

## 10. Success Criteria and Evaluation

The product Quality Checks are not the same as the capstone evaluation.

**In-product Quality Checks** help the user identify structural problems, such as missing acceptance criteria, invalid source references, or requirements without implementation stories.

**Capstone Evaluation** compares Throughline with a manual project-initialization baseline.

### 10.1 Evaluation Design

Use three controlled software project briefs.

**Manual condition:**

```text
Brief -> structured template -> Requirements -> Architecture -> Backlog
```

**Throughline condition:**

```text
Brief -> Throughline workflow
```

A fixed review checklist shall be prepared before running the test.

### 10.2 Evaluation Measures

No success figures or preferred directions are set in advance. The evaluation records what happens under the manual and Throughline conditions and reports positive or negative findings as observed.

| Measure | What is measured |
|---|---|
| Completion time | Time required to produce the agreed planning outputs under the manual and Throughline conditions |
| Requirements completeness | Results of the same fixed completeness checklist applied to both conditions |
| Acceptance-criteria completeness | Presence and completeness of acceptance criteria in the produced requirements and stories |
| Traceability coverage | How many produced backlog items have valid source lineage and how many missing links are surfaced as warnings |
| Backlog coverage | How many important approved requirements are mapped to implementation stories or explicitly identified as uncovered |
| Change-impact accuracy | Correct affected items found, affected items missed, and unaffected items incorrectly flagged in the controlled change test |
| Explainability | Whether the reviewer can inspect and understand the dependency path/reason behind each impact warning |

### 10.3 Controlled Change Test

Each sample project will receive a predefined upstream change. The answer key is written before running the system.

The evaluation records:

- true affected items identified
- affected items missed
- unaffected items incorrectly flagged
- time required to understand the impact

### 10.4 Evaluation Limitations

The write-up shall state clearly that the evaluation is exploratory:

- `n = 3`
- likely one reviewer
- developer may also be evaluator
- small capstone setting
- not evidence of product-market fit

Negative findings shall be reported honestly.

---

## 11. Business Risks and Mitigations

| Risk | Why it matters | MVP mitigation / response |
|---|---|---|
| **Low usage frequency** | Individual developers may start only a few projects per year | Treat agencies/platform teams as a stronger future segment; do not claim the capstone proves retention |
| **Weak moat in AI generation** | Requirements, stories, and architecture text are increasingly commodity AI features | Position lineage, exact provenance, approval history, and change impact as the differentiating mechanism |
| **Trust loss from false warnings** | If every change marks everything stale, users will ignore the system | Reuse unchanged ItemVersions; traverse from changed/removed items; distinguish direct vs transitive impact |
| **Missed semantic dependency** | Incorrect source mapping can hide real impact | AI proposes semantic dependencies; code validates references; human approval remains authoritative; limitations are explicit |
| **Third-party dependency** | GitHub, Stitch, Jira, or LLM APIs can fail or change | Preview actions, persist first-party state, use fallbacks/reconciliation, and keep integration boundaries narrow |
| **Scope overrun** | Three integrations can consume the 8-day build | Build lineage first, one GitHub template, one Stitch flow, one Jira project; cut P1 before P0 |
| **Security / credential misuse** | Hosted app holds API credentials capable of external writes | Server-side secrets, protected hosted access, explicit external-write confirmation, no credentials in generated repos |
| **Architecture/template mismatch** | A single starter cannot represent every AI-proposed architecture | Support scaffold mode only when compatible; otherwise use docs-only GitHub output |

---

## 12. Cost Model for the Capstone

The capstone should minimize cash cost and measure variable AI/integration usage rather than optimize a production pricing model.

| Cost area | Capstone approach | Future commercial consideration |
|---|---|---|
| Developer effort | 8 full-time days; main project cost | Product engineering, support, integration maintenance |
| Throughline hosting | Use a low-cost/free development tier where practical | Usage-based web/server hosting |
| PostgreSQL | Development/free tier where practical | Storage, backups, production availability |
| LLM usage | Usage-based; record tokens/model/latency per generated version | Likely the main variable cost; optimize prompts/models and consider per-project pricing |
| GitHub | Use development/personal account capabilities needed for demo | App permissions, organization support, support burden |
| Jira | Use one configured project/account for demo | Customer OAuth/app installation and configuration differences |
| Stitch | Use available programmatic workflow for the capstone | Availability/support/pricing risk must be reassessed before commercialization |
| File/object storage | Minimal storage for Stitch screenshots/HTML and metadata | Scales with projects and retained artifacts |

The capstone does not require a final SaaS price. A future business case should compare per-project infrastructure cost with willingness to pay, especially because project initialization is not a daily activity for many users.

---

## 13. Assumptions and Dependencies

| Assumption | If false / consequence |
|---|---|
| One Project Creator is enough for the capstone | Multi-user identity, permissions, and concurrent approvals would increase scope and require a different access model |
| One AI provider is enough for the MVP | A provider fallback or broader abstraction may be required, increasing integration and testing work |
| One pinned GitHub starter/template is enough to prove repository initialization | More architectures would require additional templates or more projects to fall back to docs-only mode |
| One configured Jira project is enough to prove one-way backlog creation | Multi-project configuration and project-specific field mapping would need to move into scope |
| One Stitch generation per approved UI Requirements version is enough to prove design handoff | Variants, iterative editing, and comparison workflows would require additional UI and API work |
| The hosted Throughline instance can be access-restricted for the demo | Exposed credentials and external-write capabilities would create an unacceptable security risk; deployment approach would need to change |
| External APIs are available often enough for a live demo | The demo must rely on preview/fallback artifacts and previously persisted outputs rather than live third-party execution |

The highest-risk integrations shall be tested early through small technical spikes before polished screens are built.

---

## 14. P1 / Future Opportunities

If time remains, possible P1 improvements include:

- AI-written semantic change-impact explanations
- architecture semantic quality critique
- Stitch variants and iterative editing
- multiple GitHub templates
- multiple Jira configurations
- richer dependency visualization
- more advanced semantic quality analysis

Possible longer-term product directions include:

- ongoing project decision tracking beyond initialization
- deeper Jira/GitHub lifecycle awareness
- team/organization workflows
- reusable agency/project templates
- existing-codebase modernization planning

These are not required to validate the capstone.

---

## 15. Relationship to Technical Documentation

This BRD defines **why Throughline exists, who it serves, what business outcomes matter, what is in scope, and how success will be judged**.

Detailed implementation behavior is intentionally separated into:

**Throughline - Technical Requirements & Lineage Invariants**

That technical document defines:

- FR/NFR behavior
- approval workflow rules
- item/version identity
- semantic hashing
- lineage and impact traversal
- GitHub/Stitch/Jira integration behavior
- retry/reconciliation rules
- P0/P1 technical boundaries
- acceptance criteria and AI-agent guardrails

Identifier namespaces are intentionally separated across the document set: **BO-xxx** is reserved for Business Objectives, **BR-xxx** for Business Requirements, **FR-xxx/NFR-xxx** for detailed functional/non-functional requirements, and **INV-xxx** for technical lineage/workflow invariants. This avoids ambiguous references in Jira tickets, commits, and AI-agent instructions.

The ERD/Data Model should be derived from the technical requirements rather than invented independently.
