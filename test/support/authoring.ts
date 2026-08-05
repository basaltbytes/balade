import * as ai from "@earendil-works/pi-ai";
import * as coding from "@earendil-works/pi-coding-agent";
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { Effect, Layer, Option } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { WalkthroughAuthor } from "../../src/pi/author.js";
import { piWalkthroughAuthorLayer } from "../../src/pi/client.js";
import { shellLayer } from "../../src/live.js";
import type { PullSnapshot } from "../../src/git/git.js";
import type {
  AuthoringDecisionExpectation,
  AuthoringEvalCase,
  AuthoringTranscriptStep,
} from "../fixtures/authoring.js";

const NO_BACKGROUND_MAINTENANCE: ReadonlyArray<readonly [string, string]> = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
  ["gc.autoDetach", "false"],
];

function git(directory: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Authoring fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Authoring fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
}

function writeFiles(directory: string, files: Readonly<Record<string, string>>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(directory, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
}

function commit(directory: string, message: string): string {
  git(directory, ["add", "-A"]);
  git(directory, ["commit", "--no-gpg-sign", "-m", message]);
  return git(directory, ["rev-parse", "HEAD"]).trim();
}

export interface AuthoringFixtureRepo {
  readonly directory: string;
  readonly source: PullSnapshot;
  readonly cleanup: () => void;
}

export function createAuthoringFixtureRepo(fixture: AuthoringEvalCase): AuthoringFixtureRepo {
  const directory = mkdtempSync(join(tmpdir(), `balade-authoring-${fixture.id}-`));
  git(directory, ["init", "-b", "main"]);
  git(directory, ["config", "user.email", "fixture@example.com"]);
  git(directory, ["config", "user.name", "Authoring fixture"]);
  git(directory, ["config", "commit.gpgsign", "false"]);
  for (const [key, value] of NO_BACKGROUND_MAINTENANCE) {
    git(directory, ["config", key, value]);
  }

  writeFiles(directory, fixture.baseFiles);
  const base = commit(directory, "base");
  git(directory, ["checkout", "-b", `feature/${fixture.id}`]);
  for (const path of Object.keys(fixture.baseFiles)) {
    if (!(path in fixture.headFiles)) rmSync(join(directory, path), { force: true });
  }
  writeFiles(directory, fixture.headFiles);
  const pin = commit(directory, fixture.title);
  const additions = fixture.changedFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = fixture.changedFiles.reduce((sum, file) => sum + file.deletions, 0);

  return {
    directory,
    source: {
      root: directory,
      repoSlug: `fixture/${fixture.id}`,
      pin,
      base,
      head: pin,
      pull: {
        number: 14,
        url: `https://github.com/fixture/${fixture.id}/pull/14`,
        author: "fixture-author",
        state: "open",
        base: "main",
        head: `feature/${fixture.id}`,
        commits: 1,
        stats: { files: fixture.changedFiles.length, additions, deletions },
      },
      claims: {
        github: Option.some({ title: fixture.title, body: "", linkedIssues: [] }),
        commitSubjects: [fixture.title],
      },
      files: fixture.changedFiles.map((file) => ({ ...file, binary: false })),
      notices: [],
    },
    cleanup: () =>
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

function fauxResponse(step: AuthoringTranscriptStep) {
  if (step._tag === "Submit") {
    return ai.fauxAssistantMessage(
      ai.fauxToolCall("submit_walkthrough", {
        title: step.draft.title,
        meta: step.draft.meta,
        body: step.draft.body,
        ...(step.draft.preset === undefined ? {} : { preset: step.draft.preset }),
      }),
      { stopReason: "toolUse" },
    );
  }
  return ai.fauxAssistantMessage(ai.fauxToolCall(step.name, { ...step.input }), {
    stopReason: "toolUse",
  });
}

export async function createAuthoringFauxHarness(
  transcript: readonly AuthoringTranscriptStep[],
  snapshotCacheRoot: string,
) {
  const credentials = new ai.InMemoryCredentialStore();
  const modelRuntime = await coding.ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
  });
  const faux = ai.fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const final = transcript.at(-1);
  const repairResponses =
    final?._tag === "Submit" ? [fauxResponse(final), fauxResponse(final)] : [];
  faux.setResponses([...transcript.map(fauxResponse), ...repairResponses]);
  const layer = piWalkthroughAuthorLayer({
    snapshotCacheRoot,
    load: async () => ({
      coding,
      ai,
      modelRuntime,
      settingsManager: coding.SettingsManager.inMemory(),
    }),
  }).pipe(Layer.provideMerge(shellLayer));
  return { faux, layer, modelRuntime };
}

export const fauxAuthorModel = Effect.fn("test.fauxAuthorModel")(function* () {
  const author = yield* WalkthroughAuthor;
  const model = (yield* author.availableModels).find(
    (candidate) => candidate.providerId === "faux",
  );
  return model === undefined ? yield* Effect.die("Faux model was not available") : model;
});

export const selectAuthorModel = Effect.fn("test.selectAuthorModel")(function* (
  providerId: string,
  modelId: string,
) {
  const author = yield* WalkthroughAuthor;
  const model = (yield* author.availableModels).find(
    (candidate) => candidate.providerId === providerId && candidate.modelId === modelId,
  );
  return model === undefined
    ? yield* Effect.die(`Model ${providerId}/${modelId} was not available`)
    : model;
});

interface DraftShape {
  readonly groups: readonly string[];
  readonly sections: number;
  readonly codeRanges: number;
  readonly codeFiles: ReadonlySet<string>;
}

function draftShape(body: string): DraftShape {
  const groups: string[] = [];
  const codeFiles = new Set<string>();
  let sections = 0;
  let codeRanges = 0;
  const visit = (nodes: readonly Node[]): void => {
    for (const node of nodes) {
      if (node.type === "tag" && node.tag === "group") {
        const label = node.attributes["label"];
        if (typeof label === "string") groups.push(label);
      }
      if (node.type === "tag" && node.tag === "section") sections++;
      if (node.type === "tag" && node.tag === "code") {
        codeRanges++;
        const file = node.attributes["file"];
        if (typeof file === "string") codeFiles.add(file);
      }
      visit(node.children);
    }
  };
  visit(Markdoc.parse(body).children);
  return { groups, sections, codeRanges, codeFiles };
}

export function authoringDecisionFailures(
  body: string,
  expected: AuthoringDecisionExpectation,
  options: { readonly checkPhrases?: boolean } = {},
): readonly string[] {
  const shape = draftShape(body);
  const failures: string[] = [];
  for (const group of expected.groups) {
    if (!shape.groups.includes(group)) failures.push(`missing group ${group}`);
  }
  for (const group of expected.omittedGroups) {
    if (shape.groups.includes(group)) failures.push(`unexpected group ${group}`);
  }
  if (shape.sections < expected.sections.minimum || shape.sections > expected.sections.maximum) {
    failures.push(
      `section count ${shape.sections} is outside ${expected.sections.minimum}-${expected.sections.maximum}`,
    );
  }
  if (
    shape.codeRanges < expected.codeRanges.minimum ||
    shape.codeRanges > expected.codeRanges.maximum
  ) {
    failures.push(
      `code range count ${shape.codeRanges} is outside ${expected.codeRanges.minimum}-${expected.codeRanges.maximum}`,
    );
  }
  for (const file of expected.referencedFiles) {
    if (!shape.codeFiles.has(file)) failures.push(`missing code evidence ${file}`);
  }
  for (const file of expected.unreferencedFiles) {
    if (shape.codeFiles.has(file)) failures.push(`unwanted code evidence ${file}`);
  }
  if (options.checkPhrases !== false) {
    for (const phrase of expected.phrases) {
      if (!body.includes(phrase)) failures.push(`missing reviewer concept: ${phrase}`);
    }
  }
  return failures;
}
