/** One clarification validator for external agents and the live clarifier. */
import { Effect, FileSystem, Option, Path, Result } from "effect";
import {
  ContextResolver,
  type BlockContext,
  type PullRange,
  type ResolveError,
} from "../contract/context.js";
import { changedLines, sourceLines } from "../contract/diff.js";
import type { Block, Payload } from "../contract/types.js";
import { parseDocument } from "./document.js";
import { compileFragment, parseFragment, FragmentInvalid } from "./fragment.js";
import { readWalkthrough, type WalkthroughFileReadFailed } from "./source.js";

export type AnswerCheckResult =
  | { readonly _tag: "Accepted"; readonly blocks: readonly [Block, ...Block[]] }
  | { readonly _tag: "Rejected"; readonly diagnostics: readonly string[] };

export interface PayloadAnswerSource {
  readonly _tag: "Payload";
  /** Decode stored JSON with `decodePayload` before checking an answer. */
  readonly payload: Payload;
}

export interface RepositoryAnswerSource extends PullRange {
  readonly _tag: "Repository";
  readonly repository: string;
  /** Absolute or relative to `repository`; may be outside the clone. */
  readonly file: string;
}

export type AnswerSource = PayloadAnswerSource | RepositoryAnswerSource;
export type AnswerCheckError = ResolveError | WalkthroughFileReadFailed;
type AnswerServices = ContextResolver | FileSystem.FileSystem | Path.Path;

export interface AnswerContext<E, R> {
  readonly file: string;
  readonly preset: string | undefined;
  readonly resolve: (references: readonly string[]) => Effect.Effect<BlockContext, E, R>;
}

/** Keep parsing, reference discovery and block diagnostics identical for every adapter. */
export const checkAnswerWithContext: <E, R>(
  body: string,
  context: AnswerContext<E, R>,
) => Effect.Effect<Result.Result<readonly [Block, ...Block[]], FragmentInvalid>, E, R> = Effect.fn(
  "checkAnswerWithContext",
)(function* <E, R>(body: string, context: AnswerContext<E, R>) {
  const parsed = parseFragment(body, context.file, context.preset);
  if (Result.isFailure(parsed)) return Result.fail(parsed.failure);
  const resolved = yield* context.resolve(parsed.success.references);
  return compileFragment(parsed.success, resolved, context.file, "clarification");
});

/** Payload checking requires no services or Node built-ins. Repository checking uses the caller's services. */
export function checkAnswerEffect(
  body: string,
  source: PayloadAnswerSource,
): Effect.Effect<AnswerCheckResult>;
export function checkAnswerEffect(
  body: string,
  source: AnswerSource,
): Effect.Effect<AnswerCheckResult, AnswerCheckError, AnswerServices>;
export function checkAnswerEffect(
  body: string,
  source: AnswerSource,
): Effect.Effect<AnswerCheckResult, AnswerCheckError, AnswerServices> {
  const checked =
    source._tag === "Payload"
      ? checkPayloadAnswer(body, source.payload)
      : checkRepositoryAnswer(body, source);
  return checked.pipe(
    Effect.map(
      (result): AnswerCheckResult =>
        Result.isSuccess(result)
          ? { _tag: "Accepted", blocks: result.success }
          : { _tag: "Rejected", diagnostics: result.failure.diagnostics },
    ),
  );
}

const checkRepositoryAnswer = Effect.fn("checkRepositoryAnswer")(function* (
  body: string,
  source: RepositoryAnswerSource,
) {
  const path = yield* Path.Path;
  const absolute = path.resolve(source.repository, source.file);
  const text = yield* readWalkthrough(absolute, source.file);
  const document = parseDocument(text, source.file);
  if (document.frontmatter === null) {
    return Result.fail(
      new FragmentInvalid({
        diagnostics: document.diagnostics.map(
          (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
        ),
      }),
    );
  }
  const { frontmatter } = document;
  const resolver = yield* ContextResolver;
  const { repository, file, _tag, ...range } = source;
  return yield* checkAnswerWithContext(body, {
    file,
    preset: frontmatter.preset,
    resolve: (references) =>
      resolver
        .resolve({
          cwd: repository,
          file,
          pr: frontmatter.pr,
          commit: frontmatter.commit,
          references,
          resolution: { _tag: "PullRange", ...range },
        })
        .pipe(Effect.map(({ ctx }) => ctx)),
  });
});

const checkPayloadAnswer = Effect.fn("checkPayloadAnswer")(function* (
  body: string,
  payload: Payload,
) {
  const files = new Map(payload.files.map((file) => [file.path, file]));
  return yield* checkAnswerWithContext(body, {
    file: payload.sourcePath,
    preset: payload.preset,
    resolve: (references) => {
      const missing = references.filter((path) => !files.has(path));
      if (missing.length > 0) {
        return Effect.fail(
          new FragmentInvalid({
            diagnostics: missing.map(
              (path) =>
                `file-unresolvable: \`${path}\` is not in the payload. Payload answers can reference only changed files; use a repository source to reference unchanged files.`,
            ),
          }),
        );
      }
      // Only code references need overlays; prose-only answers need no diff scan.
      const context: BlockContext = {
        pin: payload.commit,
        files: payload.files,
        changed: new Map(
          references.map((path) => [path, changedLines(files.get(path)?.diff?.unified ?? "")]),
        ),
        blob: (path) => {
          const content = files.get(path)?.diff?.newContent;
          return content == null ? Option.none() : Option.some(sourceLines(content));
        },
      };
      return Effect.succeed(context);
    },
  }).pipe(Effect.catchTag("FragmentInvalid", (error) => Effect.succeed(Result.fail(error))));
});
