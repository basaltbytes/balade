/**
 * The git and file reads served mode makes. Every endpoint reaches disk
 * through this adapter, so the API above it is a function of the values it
 * answers and a test supplies its own.
 *
 * Two costs live here and are kept apart on purpose: `load` shells out to git
 * some twenty-five times and is what the payload cache exists to avoid; `pin`,
 * `row`, `head` and `distance` are one file read or one git call each and run
 * per request.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { loadWalkthrough, type LoadError, type LoadResult } from "../walkthrough/load.js";
import { CommandExecutor, gitOut, type CommandFailed } from "../shell.js";
import { repoSlug, resolveCommit } from "../git/git.js";
import {
  frontmatterBlock,
  parseFrontmatter,
  type Frontmatter,
} from "../walkthrough/frontmatter.js";

/** What one index row needs, read straight from the file and from git. */
export interface IndexRow {
  title: string;
  pr: number;
  meta: Record<string, string>;
  /** ISO date of the last commit that touched the file. */
  updatedAt: string;
  /** `section` tags the file declares — the progress denominator of the row. */
  sections: number;
}

export interface ServerRepoShape {
  readonly root: string;
  /** `owner/name` when the remote is known, else the repository directory name. */
  readonly slug: string;
  /** Current HEAD; one third of a payload cache key. */
  readonly head: Effect.Effect<string, CommandFailed>;
  /** The stamp the file carries now, or `None` when its frontmatter is unreadable. */
  readonly pin: (sourcePath: string) => Effect.Effect<Option.Option<string>, ServerRepoError>;
  /** Commits between a stamp and HEAD, or `None` when the stamp is not in this clone. */
  readonly distance: (pin: string) => Effect.Effect<Option.Option<number>, ServerRepoError>;
  /** Index-row facts, or `None` when the file no longer carries a valid envelope. */
  readonly row: (sourcePath: string) => Effect.Effect<Option.Option<IndexRow>, ServerRepoError>;
  /** Compiles one walkthrough. Slow: the payload cache calls it once per key. */
  readonly load: (sourcePath: string) => Effect.Effect<LoadResult, LoadError | ServerRepoError>;
}

export class ServerSourceReadFailed extends Schema.TaggedErrorClass<ServerSourceReadFailed>()(
  "ServerSourceReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {}

export type ServerRepoError = CommandFailed | ServerSourceReadFailed;

export interface RepoOptions {
  /** Absolute repository root; every `sourcePath` is relative to it. */
  root: string;
  /** Commit the walkthrough sources are read at; absent means the working tree. */
  at?: string;
  /** Chrome language override (`--lang`). */
  lang?: "en" | "fr";
  /** `false` skips gh entirely. */
  useGh?: boolean;
}

type RepoDependencies = FileSystem.FileSystem | Path.Path | CommandExecutor;

export class ServerRepo extends Context.Service<ServerRepo, ServerRepoShape>()(
  "@balade/ServerRepo",
) {
  static layer(options: RepoOptions) {
    return Layer.effect(
      ServerRepo,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dependencies = Context.pick(
          FileSystem.FileSystem,
          Path.Path,
          CommandExecutor,
        )(yield* Effect.context<RepoDependencies>());
        return yield* makeServerRepo(options, fs, path, dependencies);
      }),
    );
  }
}

const makeServerRepo = Effect.fn("makeServerRepo")(function* (
  options: RepoOptions,
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dependencies: Context.Context<RepoDependencies>,
) {
  const { root, at } = options;
  const absolute = (sourcePath: string): string => path.join(root, sourcePath);
  const run = <A, E>(effect: Effect.Effect<A, E, RepoDependencies>): Effect.Effect<A, E> =>
    effect.pipe(Effect.provide(dependencies));

  /** The walkthrough text as served: the working tree, or a blob at `at`. */
  const readSource = (sourcePath: string): Effect.Effect<string, ServerRepoError> =>
    at === undefined
      ? read(fs, absolute(sourcePath))
      : run(gitOut(["show", `${at}:${sourcePath}`], root));

  /** The source as it is served now, with its envelope proven. */
  const envelope = Effect.fn("serverRepo.envelope")(function* (sourcePath: string) {
    const source = yield* readSource(sourcePath);
    const block = frontmatterBlock(source);
    if (block === null) return Option.none<{ source: string; frontmatter: Frontmatter }>();
    const frontmatter = parseFrontmatter(block, sourcePath).frontmatter;
    return frontmatter === null ? Option.none() : Option.some({ source, frontmatter });
  });

  const slug = yield* run(repoSlug(root));
  return {
    root,
    slug,

    head:
      at === undefined
        ? run(gitOut(["rev-parse", "HEAD"], root)).pipe(Effect.map((out) => out.trim()))
        : Effect.succeed(at),

    pin: Effect.fn("ServerRepo.pin")((sourcePath) =>
      envelope(sourcePath).pipe(Effect.map(Option.map((found) => found.frontmatter.commit))),
    ),

    distance: Effect.fn("ServerRepo.distance")((pin) =>
      run(
        Effect.gen(function* () {
          const commit = yield* resolveCommit(root, pin);
          if (Option.isNone(commit)) return Option.none();
          const out = yield* gitOut(
            ["rev-list", "--count", `${commit.value}..${at ?? "HEAD"}`],
            root,
          );
          const count = Number(out.trim());
          return Number.isFinite(count)
            ? Option.some(count)
            : yield* Effect.die(new Error("git rev-list returned a non-numeric count"));
        }),
      ),
    ),

    row: Effect.fn("ServerRepo.row")((sourcePath) =>
      Effect.gen(function* () {
        const found = yield* envelope(sourcePath);
        if (Option.isNone(found)) return Option.none();
        const value = found.value;
        const updatedAt = (yield* run(
          gitOut(
            ["log", "-1", "--format=%cI", ...(at === undefined ? [] : [at]), "--", sourcePath],
            root,
          ),
        )).trim();
        return Option.some({
          title: value.frontmatter.title,
          pr: value.frontmatter.pr,
          meta: value.frontmatter.meta,
          updatedAt,
          sections: countSections(value.source),
        });
      }),
    ),

    load: Effect.fn("ServerRepo.load")((sourcePath) =>
      Effect.gen(function* () {
        const source = at === undefined ? undefined : yield* readSource(sourcePath);
        return yield* run(
          loadWalkthrough({
            cwd: root,
            path: absolute(sourcePath),
            ...(source !== undefined ? { source } : {}),
            ...(at !== undefined ? { at } : {}),
            ...(options.lang !== undefined ? { lang: options.lang } : {}),
            ...(options.useGh !== undefined ? { useGh: options.useGh } : {}),
          }),
        );
      }),
    ),
  } satisfies ServerRepoShape;
});

const read = (fs: FileSystem.FileSystem, path: string) =>
  fs
    .readFileString(path)
    .pipe(Effect.mapError((cause) => new ServerSourceReadFailed({ path, cause })));

/** The index counts sections without resolving anything: a parse, no git. */
function countSections(source: string): number {
  let count = 0;
  const walk = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "tag" && node.tag === "section") count += 1;
      walk(node.children);
    }
  };
  walk(Markdoc.parse(source).children);
  return count;
}
