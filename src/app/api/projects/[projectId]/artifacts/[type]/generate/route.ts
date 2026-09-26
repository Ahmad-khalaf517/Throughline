import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { createDraftFromGeneration, getArtifactId, getProjectById } from '@/artifact-lifecycle';
import { createOptions } from '@/artifact-types/architecture';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  ARTIFACT_TYPE_DISPATCH,
  loadVersionDTO,
  missingPrerequisites,
  parseArtifactType,
  prerequisiteVersionIds,
  type GenerateOutput,
} from '@/app/api/_shared/artifacts';
import { readOptionalJsonBody } from '@/app/api/_shared/body';
import { generateSchema } from '../../schemas';

interface RouteParams {
  params: Promise<{ projectId: string; type: string }>;
}

/**
 * `POST /api/projects/:projectId/artifacts/:type/generate` -> API Contracts
 * section 4: `artifact-lifecycle.createDraftFromGeneration`, with the `:type`
 * module's own `generate` (prompt, output schema, `toCandidates`, the model
 * call) as its callback.
 *
 * Order: auth (401) -> project ownership (404) -> `:type` (404) -> body (400) ->
 * FR-080 prerequisites (409 `PREREQUISITE_NOT_APPROVED`, `details.missing`) ->
 * the domain call. The prerequisite check runs before anything is generated:
 * `generate` itself re-checks it, but as a plain `Error` this route would
 * surface as a 500 and only after a wasted model call's worth of setup.
 *
 * A stale result is `200 { status: 'stale' }`, never an error: the call
 * succeeded exactly as designed (ERD 3.3 step 4) by recording a rejected version
 * for audit.
 *
 * Known limitation (Architecture only): the draft and its two options are
 * persisted in TWO transactions. `createDraftFromGeneration` commits the draft,
 * then `architecture.createOptions` commits the options - that write needs the
 * draft's id, and the lifecycle call cannot take the options as a parameter
 * (Module Boundaries 4.3's signature has no such field). A failure between the
 * two (a crash, a dropped connection) leaves an option-less Architecture draft.
 * It is harmless but useless: approving it answers `422 OPTION_COUNT_INVALID`
 * (there are not two options), and the next generate replaces it (ERD 3.1
 * `draft_replaced`). Options are never written for a stale result - that
 * version is rejected and has no items or options to choose between.
 *
 * A model failure (ai-client throws a plain `Error`, or the provider SDK's own
 * error) has no documented API Contracts 11 code, so it is deliberately not
 * mapped: it falls through to `errorResponse`'s generic 500 `INTERNAL_ERROR`.
 * `generateStructured` has already logged the failed `ai_generation_run`, and
 * nothing was persisted (`createDraftFromGeneration` calls `generate` before it
 * opens any transaction).
 *
 * artifact-lifecycle is called directly - Module Boundaries 4.7's
 * artifact/version-route exception (src/app/api/README.md 4).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId, type: rawType } = await params;
    await requireProjectOwner(user.id, projectId);
    const type = parseArtifactType(rawType);

    const body = await readOptionalJsonBody(request);
    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const missing = missingPrerequisites(project, type);
    if (missing.length) {
      throw new ApiError(
        'PREREQUISITE_NOT_APPROVED',
        `Approve ${missing.join(', ')} before generating ${type}.`,
        { missing },
      );
    }

    const artifactId = await getArtifactId(projectId, type);
    if (!artifactId) throw new ApiError('NOT_FOUND', 'Artifact not found.');

    const dispatch = ARTIFACT_TYPE_DISPATCH[type];
    // Held in an object, not a `let`: TypeScript does not see an assignment
    // made inside the callback below, and would narrow a plain `let` to
    // `undefined` at the read after the await.
    const generated: { output?: GenerateOutput } = {};
    const result = await createDraftFromGeneration({
      projectId,
      artifactId,
      ...(dispatch.defaultItemType ? { itemType: dispatch.defaultItemType } : {}),
      contextSourceVersionIds: prerequisiteVersionIds(project, type),
      actorUserId: user.id,
      // Thread the ids `createDraftFromGeneration` captured (the same
      // `contextSourceVersionIds` passed just above, plus the `baseVersionId` it
      // read) into the module, so the prompt is built from exactly the versions
      // the draft is recorded against rather than a third read of the project
      // (INV-006: the model must see what `generation_context_ref` says it saw).
      generate: async (ctx) => {
        const output = await dispatch.generate({
          projectId,
          feedback: parsed.data.feedback,
          contextSourceVersionIds: ctx.contextSourceVersionIds,
          baseVersionId: ctx.baseVersionId,
        });
        generated.output = output;
        return output;
      },
    });

    if (result.stale) {
      return NextResponse.json({
        status: 'stale',
        version: await loadVersionDTO(result.version.id),
        reason: result.reason,
      });
    }

    if (type === 'architecture') {
      if (!generated.output?.options) {
        // architecture.generate always returns its two options; reaching here
        // would mean the dispatch table is wired to the wrong module.
        throw new Error('architecture generate returned no options');
      }
      await createOptions(result.version.id, generated.output.options);
    }

    return NextResponse.json({
      status: 'ok',
      version: await loadVersionDTO(result.version.id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
