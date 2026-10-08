# Production security pass — E6-S3 / SCRUM-69

Run date: 2026-09-28 UTC. Baseline checkout: 8726800 (the hosted E6-S1 production commit). Scope: production Supabase and the configured hosted app, using the production configuration from the main checkout in memory. No credential values, database URLs, project IDs, tokens, response bodies, or generated content were written to this report. No production data, grant, or schema change was committed.

## Result

**ERD T34 passes on the real production Supabase project.** All 16 public-key Data API reads and the impact RPC returned HTTP 401 with SQLSTATE 42501. The production database has RLS enabled with zero policies on all 16 tables, no anon or authenticated CRUD privilege on them, and no anon, authenticated, or PUBLIC EXECUTE privilege on impact(uuid, uuid). A temporary SELECT grant to anon exposed zero rows from a known existing project; the transaction rolled back.

**NFR-005 credential leak check: no exact configured secret value was found in the public surfaces inspected.** This is a scoped result. Production currently has no GitHub repository refs and no stored Stitch HTML assets, so a live generated repository or HTML payload could not be checked.

## T34 public-key HTTP checks

Requests used the configured Supabase publishable/anon key as both apikey and Bearer token against the production /rest/v1 endpoint. Every table used GET with select and limit=1. The RPC used POST /rest/v1/rpc/impact with a well-formed, nonexisting project UUID.

| Table | GET status | Error code |
| --- | ---: | --- |
| app_user | 401 | 42501 |
| project | 401 | 42501 |
| artifact | 401 | 42501 |
| artifact_version | 401 | 42501 |
| architecture_option | 401 | 42501 |
| approval_event | 401 | 42501 |
| logical_item | 401 | 42501 |
| item_version | 401 | 42501 |
| artifact_version_item_membership | 401 | 42501 |
| generation_context_ref | 401 | 42501 |
| semantic_dependency | 401 | 42501 |
| external_operation | 401 | 42501 |
| external_ref | 401 | 42501 |
| impact_acknowledgement | 401 | 42501 |
| ai_generation_run | 401 | 42501 |
| stitch_output | 401 | 42501 |
| impact RPC | 401 | 42501 |

Production PostgreSQL catalog check: 16/16 tables existed, 16/16 had relrowsecurity=true, and each had zero pg_policy entries. For both anon and authenticated, has_table_privilege returned false for SELECT, INSERT, UPDATE, and DELETE on every table (128 false privilege checks). Both roles were non-login, nonsuperuser, and non-BYPASSRLS. has_function_privilege for EXECUTE on public.impact(uuid, uuid) was false for anon, authenticated, and PUBLIC.

Write checks used SET LOCAL ROLE anon inside individual explicit transactions, with unconditional ROLLBACK. INSERT DEFAULT VALUES and DELETE WHERE false each returned SQLSTATE 42501 on all 16 tables (32 checks). UPDATE WHERE false on project and app_user also returned 42501 (2 checks). These checks caused no persisted writes. The public-key HTTP checks covered reads and RPC; write denial was exercised through the same underlying anon database role inside rolled-back SQL transactions, avoiding any production Data API write that might persist if an unexpected grant existed.

For the accidental-grant control, the table owner first confirmed an existing project row. One explicit transaction issued GRANT SELECT ON public.project TO anon, then SET LOCAL ROLE anon and SELECT of that exact row. The result was zero rows, with no error; ROLLBACK removed the temporary grant. This proves the independent no-policy RLS layer hid a real row even when table SELECT was granted. The grant was never committed.

## Credential and generated-output checks

Eight configured server-only values were compared in memory as exact byte strings: DATABASE_URL, DIRECT_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, GITHUB_TOKEN, GITHUB_MARKER_SECRET, JIRA_API_TOKEN, and STITCH_API_KEY. The public Supabase key, Supabase URL, and site URL were excluded because they are intentionally public. Only names, counts, status codes, and boolean match results were retained.

| Surface | Scope scanned | Exact secret matches |
| --- | --- | ---: |
| Hosted public HTML | /, /sign-in, /sign-up, /forgot-password; all HTTP 200 | 0 |
| JavaScript referenced by those pages | 27 static assets; all HTTP 200 | 0 |
| Production GitHub external refs | 0 refs, hence 0 repositories and 0 blobs available to scan | 0 in available data |
| Production Stitch outputs | 2 prompt rows; neither has an HTML storage key | 0 in prompt text; no HTML bytes available |

Source inspection found that GitHub repository generation writes README.md, docs/adr/*.md, and docs/architecture/lineage.json. Their builders use selected architecture data, ADR identifiers, and a truncated HMAC ownership marker; the configured GitHub token and marker secret are used by the API client and HMAC calculation, not copied into those file builders. Stitch's output table stores private-bucket object keys and checksums; the preview component uses an iframe with sandbox="allow-scripts" and no allow-same-origin. Model-derived prompt text is rendered as React text. These are code-path observations at the cited baseline, not substitutes for scanning a real generated repository or HTML asset when one exists.

The public app returned HTTP 401 for unauthenticated GET /api/projects and HTTP 307 to /sign-in for GET /projects. Production Supabase Auth settings returned disable_signup=false and mailer_autoconfirm=false, consistent with open signup plus mandatory email verification. Source inspection found auth.getUser() and project owner checks in the auth and project paths. No second-user ownership test or authenticated external-write attempt was run in this story.

## Method and limits

The targeted commands were three temporary Node scripts outside the repository, run with the worktree's installed postgres and dotenv packages and the main checkout's production environment file:

- Production REST/SQL T34 audit, first run: HTTP results passed; catalog audit stopped at an incorrect one-argument impact signature in the temporary script (SQLSTATE 42883). No production change occurred.
- Corrected production REST/SQL T34 audit: 16 table GETs and one RPC denied; catalog, 34 rolled-back write checks, and the rolled-back accidental-grant control passed with zero audit errors.
- Credential comparison and hosted access-gate probes: 4 HTML pages, 27 JavaScript assets, 2 Stitch prompt rows, no exact secret matches; access-gate responses as recorded above.

The actual function signature is impact(uuid, uuid), with the second argument defaulted. The first script's 42883 was an audit-script error, not a production security failure. The corrected query used that signature.

The static scan covered assets referenced by four unauthenticated pages, not every dynamically loaded or authenticated bundle. Exact byte matching does not detect transformed, split, encoded, or partially exposed secrets. The compared values came from the local production configuration; this run did not independently read the deployment provider's private environment. No generated GitHub repository or Stitch HTML asset currently exists in the production rows examined, so their live contents remain unverified. Public signup allows any email-verified user to consume shared provider credentials, which is the accepted NFR-005 risk. This pass does not retest every NFR-005 behavior; its requested production T34 and credential exposure evidence is recorded above.
