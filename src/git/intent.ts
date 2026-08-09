/** Author-controlled pull-request claims collected for walkthrough generation. */

import { Array as Arr, Effect, Option, Schema } from "effect";
import { firstLine, gh, gitOut } from "../shell.js";

export const PULL_COMMIT_SUBJECT_LIMIT = 20;

export interface PullNotice {
  readonly code: "gh-unavailable" | "third-party-linked-issue";
  readonly message: string;
  readonly hint: string;
}

export type PullLinkedIssueReference =
  | { readonly _tag: "SameRepositoryLinkedIssue"; readonly url: string }
  | {
      readonly _tag: "ThirdPartyLinkedIssue";
      readonly url: string;
      readonly repository: string;
    };

export interface PullLinkedIssueClaim {
  readonly reference: PullLinkedIssueReference;
  readonly title: string;
  readonly body: Option.Option<string>;
}

export interface PullRequestClaims {
  readonly title: string;
  readonly body: string;
  readonly linkedIssues: readonly PullLinkedIssueClaim[];
}

export interface PullIntentClaims {
  readonly github: Option.Option<PullRequestClaims>;
  readonly commitSubjects: readonly string[];
}

export interface PullRequestClaimsSource {
  readonly title: string;
  readonly body: string;
  readonly linkedIssues: readonly PullLinkedIssueReference[];
}

interface ReadPullIntentClaimsOptions {
  readonly root: string;
  readonly base: string;
  readonly pin: string;
  readonly github: Option.Option<PullRequestClaimsSource>;
}

interface PullIntentClaimsResult {
  readonly claims: PullIntentClaims;
  readonly notices: readonly PullNotice[];
}

interface LinkedIssueClaimResult {
  readonly claim: Option.Option<PullLinkedIssueClaim>;
  readonly notices: readonly PullNotice[];
}

const LinkedIssueResponse = Schema.Struct({
  title: Schema.NonEmptyString,
  body: Schema.optionalKey(Schema.String),
});

const decodeLinkedIssue = Schema.decodeUnknownEffect(LinkedIssueResponse, {
  onExcessProperty: "error",
});

export const readPullIntentClaims = Effect.fn("readPullIntentClaims")(function* (
  options: ReadPullIntentClaimsOptions,
) {
  const commitSubjects = (yield* gitOut(
    [
      "log",
      `--max-count=${PULL_COMMIT_SUBJECT_LIMIT}`,
      "--format=%s",
      `${options.base}..${options.pin}`,
    ],
    options.root,
  ))
    .split("\n")
    .filter((subject) => subject !== "");

  return yield* Option.match(options.github, {
    onNone: () =>
      Effect.succeed({
        claims: { github: Option.none(), commitSubjects },
        notices: [],
      } satisfies PullIntentClaimsResult),
    onSome: (github) =>
      Effect.gen(function* () {
        const results = yield* Effect.forEach(github.linkedIssues, (reference) =>
          readLinkedIssueClaim(options.root, reference),
        );
        return {
          claims: {
            github: Option.some({
              title: github.title,
              body: github.body,
              linkedIssues: Arr.getSomes(results.map(({ claim }) => claim)),
            }),
            commitSubjects,
          },
          notices: results.flatMap(({ notices }) => notices),
        } satisfies PullIntentClaimsResult;
      }),
  });
});

const readLinkedIssueClaim = Effect.fn("readLinkedIssueClaim")((
  root: string,
  reference: PullLinkedIssueReference,
) => {
  const provenanceNotices =
    reference._tag === "ThirdPartyLinkedIssue" ? [thirdPartyIssueNotice(reference)] : [];
  return gh(["issue", "view", reference.url, "--json", "title,body"], root).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed<LinkedIssueClaimResult>({
          claim: Option.none(),
          notices: [
            ...provenanceNotices,
            linkedIssueNotice(reference.url, `exit ${error.code}: ${firstLine(error.stderr)}`),
          ],
        }),
      onSuccess: (stdout) =>
        Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: () => linkedIssueNotice(reference.url, "its answer was not JSON"),
        }).pipe(
          Effect.flatMap((body) =>
            decodeLinkedIssue(body).pipe(
              Effect.mapError(() =>
                linkedIssueNotice(reference.url, "its answer did not match the requested fields"),
              ),
            ),
          ),
          Effect.match({
            onFailure: (notice): LinkedIssueClaimResult => ({
              claim: Option.none(),
              notices: [...provenanceNotices, notice],
            }),
            onSuccess: (response): LinkedIssueClaimResult => ({
              claim: Option.some({
                reference,
                title: response.title,
                body: Option.fromNullishOr(response.body),
              }),
              notices: provenanceNotices,
            }),
          }),
        ),
    }),
  );
});

function thirdPartyIssueNotice(
  reference: Extract<PullLinkedIssueReference, { readonly _tag: "ThirdPartyLinkedIssue" }>,
): PullNotice {
  return {
    code: "third-party-linked-issue",
    message: `Linked issue ${reference.url} comes from third-party repository ${reference.repository}.`,
    hint: "Its text remains available as an untrusted third-party claim, separate from author-stated intent.",
  };
}

function linkedIssueNotice(url: string, detail: string): PullNotice {
  return {
    code: "gh-unavailable",
    message: `gh unavailable — linked issue ${url} was omitted (${detail}).`,
    hint: "Run `gh auth login` with access to the linked issue; generation can continue with the remaining pull-request claims.",
  };
}
