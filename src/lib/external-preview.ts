// Pure presentation/serialization helpers for the GitHub/Jira/Stitch
// preview panels (E5-S9; API Contracts sections 8-10, TR FR-085). No DB, no
// `fetch`, no React here - `src/lib` is the one layer `src/components/**`
// may import (eslint.config.mjs's `{ from: ['components'], allow: ['lib'] }`,
// line 159), and `serialize.ts` already establishes that pure
// presentation/serialization glue lives here rather than in a component.
// This file is this story's testable surface (tests/unit/lib/
// external-preview.test.ts).

import type { ExternalOperationDTO, ImpactRowDTO } from './serialize';

export interface SplitImpact {
  direct: ImpactRowDTO[];
  transitive: ImpactRowDTO[];
}

/**
 * INV-022: direct (`depth === 0`) and transitive (`depth > 0`) impact are
 * always reported separately, never flattened into one list - the same
 * split `warning-panel.tsx` computes locally for its own two
 * `WarningSection`s. Every external-write preview panel reuses this one
 * function instead of re-deriving the split a second time.
 */
export function splitImpact(rows: readonly ImpactRowDTO[]): SplitImpact {
  return {
    direct: rows.filter((row) => row.depth === 0),
    transitive: rows.filter((row) => row.depth > 0),
  };
}

/**
 * FR-085's own predicate - the invariant this story exists to hold: creating
 * an external object from a flagged item is *allowed*, but only with an
 * explicit confirmation once impact is shown; empty impact never needs one.
 * Mirrors the server's own check verbatim (e.g. `github/init/route.ts`:
 * `preview.impact.length > 0 && parsed.data.impactAcknowledged !== true`) so
 * every panel's submit button is disabled by the exact same rule the server
 * re-checks - the server still never trusts the client's flag alone
 * (`IMPACT_NOT_ACKNOWLEDGED`, API Contracts section 11), this only avoids a
 * guaranteed-to-fail round trip.
 */
export function isExternalWriteBlocked(
  impact: readonly ImpactRowDTO[],
  acknowledged: boolean,
): boolean {
  return impact.length > 0 && !acknowledged;
}

/**
 * API Contracts section 9: `POST .../jira/export` 400s with
 * `VALIDATION_ERROR` if any `needsDecision` item has no matching entry in
 * `decisions`. Returns the still-undecided `logicalItemId`s so the Jira
 * panel can block submit (and name what's missing) before that round trip.
 */
export function missingJiraDecisions(
  needsDecision: readonly { logicalItemId: string }[],
  decisions: ReadonlyMap<string, 'skip' | 'create_new'>,
): string[] {
  return needsDecision
    .filter((item) => !decisions.has(item.logicalItemId))
    .map((item) => item.logicalItemId);
}

export interface OperationStatusCopy {
  label: string;
  detail: string;
  retryable: boolean;
}

/**
 * Plain-language copy for `ExternalOperationDTO['status']` (API Contracts
 * section 7). Conservative throughout: `reconciliation_required` is
 * specifically NOT "failed" - it means Throughline is checking whether the
 * write already reached the provider before doing anything else (ERD 7.2 /
 * TR sections 29-30), so it reads as "checking", not as a problem.
 */
export function describeOperationStatus(
  status: ExternalOperationDTO['status'],
): OperationStatusCopy {
  switch (status) {
    case 'pending':
      return {
        label: 'In progress',
        detail: 'This write is still being processed.',
        retryable: false,
      };
    case 'completed':
      return {
        label: 'Completed',
        detail: 'This write finished successfully.',
        retryable: false,
      };
    case 'reconciliation_required':
      return {
        label: 'Checking',
        detail:
          'Throughline is checking whether this was already created with the provider before trying again - this is not a failure.',
        retryable: true,
      };
    case 'failed':
      return {
        label: 'Failed',
        detail: "This write didn't complete. You can retry it.",
        retryable: true,
      };
  }
}

/**
 * TR section 16 (line ~683): "A Story whose Epic has no Jira issue at all is
 * not exported and is listed in the preview." The only `skipped[].reason`
 * value API Contracts section 9 documents - plain language for the preview
 * screen's skipped list.
 */
export function describeSkipReason(reason: 'epic_has_no_jira_ref'): string {
  switch (reason) {
    case 'epic_has_no_jira_ref':
      return "This Story's Epic doesn't have a Jira issue yet, so it can't be filed under it - export the Epic first, then re-run this preview.";
  }
}

/**
 * API Contracts section 11 - one specific, actionable message per error
 * code an external-write route can throw (sections 7-10). Every code named
 * in that table for this story is covered here; an unmapped code falls back
 * to the server's own `error.message` in `describeExternalError` below,
 * never a bare "Something went wrong" for a code the contract names.
 */
export const EXTERNAL_ERROR_COPY: Record<string, string> = {
  PREREQUISITE_NOT_APPROVED:
    'An upstream artifact needs to be approved first. Approve it, then come back to this preview.',
  GITHUB_ALREADY_INITIALIZED:
    'This project already has a GitHub repository, or a GitHub setup is already in progress - only one repository is created per project.',
  NAME_TAKEN_BY_OTHER:
    "That repository name already exists and isn't marked as this project's - pick a different name and try again.",
  // The panels' own `IMPACT_NOT_ACKNOWLEDGED` handling re-renders the fresh
  // `details.impact` this code carries (via `readImpactFromError`) with its
  // own specific, in-context message instead of this one - this entry is
  // only the fallback for the (should-never-happen) case where that payload
  // is missing or malformed, so it can't point at impact that isn't there.
  IMPACT_NOT_ACKNOWLEDGED:
    "New impact was found while preparing this write, but it couldn't be shown here - reload this page and try again.",
  ALREADY_GENERATED:
    'A Stitch UI prototype has already been generated for this UI Requirements version - only one is created per version.',
  REQUEST_CONFLICT:
    "This request's inputs no longer match an earlier attempt for the same write. Refresh this preview and try again.",
  VALIDATION_ERROR: 'The request was invalid - re-check the form and try again.',
  NOT_FOUND: 'That project or item could not be found.',
};

/**
 * Looks up `EXTERNAL_ERROR_COPY` for a route's `error.code` (API Contracts
 * 1.3), falling back to the server's own `error.message` when the code is
 * unknown - never a generic message for a code the contract does document,
 * and never a blank message for one it doesn't.
 */
export function describeExternalError(code: string | undefined, fallbackMessage: string): string {
  const copy = code ? EXTERNAL_ERROR_COPY[code] : undefined;
  return copy ?? fallbackMessage;
}

/**
 * Extracts the `details.impact` array a `409 IMPACT_NOT_ACKNOWLEDGED`
 * response carries (API Contracts sections 8-10: `{ details: { impact:
 * ImpactRowDTO[] } }`). The write routes recompute impact fresh at write
 * time (INV-025 - impact is evaluated on every read, never cached), so this
 * payload can legitimately differ from whatever the panel's own preview
 * fetch saw moments earlier; it exists precisely so the client can re-render
 * the newly-discovered rows instead of dead-ending on a message that points
 * at impact the user was never shown.
 *
 * Structurally validated rather than trusted outright: returns `null` for
 * anything malformed, missing, or empty, so a caller can fall back to its
 * generic error path instead of clearing impact to `[]` and silently
 * re-enabling submit (an empty `impact` here would be a contradiction - the
 * route only sends this code when `preview.impact.length > 0`).
 */
export function readImpactFromError(body: unknown): ImpactRowDTO[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const errorValue = (body as { error?: unknown }).error;
  if (typeof errorValue !== 'object' || errorValue === null) return null;
  const details = (errorValue as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return null;
  const impact = (details as { impact?: unknown }).impact;
  if (!Array.isArray(impact) || impact.length === 0) return null;
  return impact as ImpactRowDTO[];
}
