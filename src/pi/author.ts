/**
 * The balade-owned boundary around Pi. The command and generation workflow
 * speak only these values; vendor models, events, sessions and errors stop in
 * `client.ts`.
 */

import { Context, Effect, Option, Redacted, Schema, Scope } from "effect";
import type { PullIntentClaims } from "../git/intent.js";
import type { Lang } from "../contract/types.js";
import type { SnapshotOpenFailed, SnapshotPathRejected, SnapshotReadFailed } from "./snapshot.js";

export const AuthorProviderId = Schema.NonEmptyString.pipe(
  Schema.brand("@balade/AuthorProviderId"),
);
export type AuthorProviderId = typeof AuthorProviderId.Type;

export const AuthorModelId = Schema.NonEmptyString.pipe(Schema.brand("@balade/AuthorModelId"));
export type AuthorModelId = typeof AuthorModelId.Type;

export const AuthorModel = Schema.Struct({
  providerId: AuthorProviderId,
  providerName: Schema.NonEmptyString,
  modelId: AuthorModelId,
  modelName: Schema.NonEmptyString,
});
export type AuthorModel = typeof AuthorModel.Type;

export const AuthorModelPreference = Schema.Struct({
  providerId: AuthorProviderId,
  modelId: AuthorModelId,
});
export type AuthorModelPreference = typeof AuthorModelPreference.Type;

export const AuthorLoginMethod = Schema.Struct({
  providerId: AuthorProviderId,
  providerName: Schema.NonEmptyString,
  method: Schema.Literals(["oauth", "api_key"]),
  label: Schema.NonEmptyString,
  billing: Schema.Literals(["standard", "anthropic-extra-usage"]),
});
export type AuthorLoginMethod = typeof AuthorLoginMethod.Type;

export type LoginPrompt =
  | {
      readonly type: "text" | "manual_code";
      readonly message: string;
      readonly placeholder?: string;
      readonly signal?: AbortSignal;
    }
  | {
      readonly type: "select";
      readonly message: string;
      readonly options: readonly {
        readonly id: string;
        readonly label: string;
        readonly description?: string;
      }[];
      readonly signal?: AbortSignal;
    };

export interface LoginSecretPrompt {
  readonly type: "secret";
  readonly message: string;
  readonly placeholder?: string;
  readonly signal?: AbortSignal;
}

export type LoginNotification =
  | {
      readonly type: "info";
      readonly message: string;
      readonly links: readonly { readonly url: string; readonly label?: string }[];
    }
  | { readonly type: "auth_url"; readonly url: string; readonly instructions?: string }
  | {
      readonly type: "device_code";
      readonly userCode: string;
      readonly verificationUri: string;
      readonly intervalSeconds?: number;
      readonly expiresInSeconds?: number;
    }
  | { readonly type: "progress"; readonly message: string };

export interface LoginInteraction {
  readonly prompt: (prompt: LoginPrompt) => Promise<string>;
  readonly secret: (prompt: LoginSecretPrompt) => Promise<Redacted.Redacted<string>>;
  readonly notify: (event: LoginNotification) => void;
}

export interface AuthorNotice {
  readonly _tag: "AuthorNotice";
  readonly code:
    | "head-instructions-skipped"
    | "head-instructions-trusted"
    | "project-instructions-rejected";
  readonly message: string;
  readonly hint: string;
}

export type AuthorProgress =
  | AuthorNotice
  | { readonly _tag: "AuthorAssistantText"; readonly text: string }
  | { readonly _tag: "AuthorToolStarted"; readonly name: string; readonly input: string }
  | {
      readonly _tag: "AuthorToolFinished";
      readonly name: string;
      readonly output: string;
      readonly failed: boolean;
    }
  | { readonly _tag: "AuthorUsageUpdated"; readonly usage: AuthorUsage };

export type AuthorProgressMode = "compact" | "verbose";

/** Whether repository instructions changed at the pinned head enter authoring. */
export type HeadInstructionPolicy = "omit-changed" | "trust-changed";

export interface AuthorChangedFile {
  readonly path: string;
  readonly status: "A" | "M" | "D" | "R";
  readonly additions: number;
  readonly deletions: number;
  readonly oldPath?: string;
}

/** A preset's name and the guidance that teaches its tags, supplied by the caller. */
export interface AuthoringPreset {
  readonly name: string;
  readonly authoring: string;
}

export interface AuthoringRequest {
  readonly root: string;
  readonly pin: string;
  readonly base: string;
  readonly pull: {
    readonly number: number;
    readonly url: string;
    readonly author: string;
    readonly base: string;
    readonly head: string;
    readonly commits: number;
  };
  readonly claims: PullIntentClaims;
  readonly files: readonly AuthorChangedFile[];
  readonly model: AuthorModel;
  /** Active preset, when the command line named one. */
  readonly preset?: AuthoringPreset;
  /** Named by `--lang`; the draft is authored in it and `meta.lang` is stamped. */
  readonly lang?: Lang;
  /** Named by `--prompt`; typed by the operator, so trusted — unlike PR-derived claims. */
  readonly guidance?: string;
  readonly headInstructionPolicy: HeadInstructionPolicy;
  readonly progressMode: AuthorProgressMode;
  readonly progress: (event: AuthorProgress) => void;
}

export const AuthorDraft = Schema.Struct({
  title: Schema.NonEmptyString,
  meta: Schema.Record(Schema.String, Schema.String),
  preset: Schema.optionalKey(Schema.NonEmptyString),
  body: Schema.NonEmptyString,
});
export type AuthorDraft = typeof AuthorDraft.Type;

export const AuthorUsage = Schema.Struct({
  input: Schema.Natural,
  output: Schema.Natural,
  cacheRead: Schema.Natural,
  cacheWrite: Schema.Natural,
  total: Schema.Natural,
  cost: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type AuthorUsage = typeof AuthorUsage.Type;

export interface AuthorTurn {
  readonly draft: AuthorDraft;
  /** Cumulative session usage, including prior repair turns. */
  readonly usage: AuthorUsage;
}

export class AuthorDiscoveryFailed extends Schema.TaggedErrorClass<AuthorDiscoveryFailed>()(
  "AuthorDiscoveryFailed",
  { cause: Schema.Defect() },
) {}

export class AuthorPreferenceReadFailed extends Schema.TaggedErrorClass<AuthorPreferenceReadFailed>()(
  "AuthorPreferenceReadFailed",
  { cause: Schema.Defect() },
) {}

export class AuthorPreferenceWriteFailed extends Schema.TaggedErrorClass<AuthorPreferenceWriteFailed>()(
  "AuthorPreferenceWriteFailed",
  { cause: Schema.Defect() },
) {}

export class LoginFailed extends Schema.TaggedErrorClass<LoginFailed>()("LoginFailed", {
  provider: AuthorProviderId,
  method: Schema.Literals(["oauth", "api_key"]),
  reason: Schema.Literals(["oauth", "auth", "provider", "unknown"]),
}) {}

export class LoginCancelled extends Schema.TaggedErrorClass<LoginCancelled>()(
  "LoginCancelled",
  {},
) {}

export class AuthorRuntimeLoadFailed extends Schema.TaggedErrorClass<AuthorRuntimeLoadFailed>()(
  "AuthorRuntimeLoadFailed",
  { cause: Schema.Defect() },
) {}

export class AuthorModelUnavailable extends Schema.TaggedErrorClass<AuthorModelUnavailable>()(
  "AuthorModelUnavailable",
  {
    provider: AuthorProviderId,
    model: AuthorModelId,
  },
) {}

export class AuthorSearchConfigurationFailed extends Schema.TaggedErrorClass<AuthorSearchConfigurationFailed>()(
  "AuthorSearchConfigurationFailed",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class AuthorSessionStartFailed extends Schema.TaggedErrorClass<AuthorSessionStartFailed>()(
  "AuthorSessionStartFailed",
  {
    provider: AuthorProviderId,
    model: AuthorModelId,
    cause: Schema.Defect(),
  },
) {}

export class ProviderRequestFailed extends Schema.TaggedErrorClass<ProviderRequestFailed>()(
  "ProviderRequestFailed",
  {
    provider: AuthorProviderId,
    model: AuthorModelId,
    detail: Schema.String,
  },
) {}

export class DraftMalformed extends Schema.TaggedErrorClass<DraftMalformed>()("DraftMalformed", {
  detail: Schema.String,
}) {}

export type AuthorStartupError =
  | AuthorRuntimeLoadFailed
  | AuthorModelUnavailable
  | SnapshotOpenFailed
  | SnapshotReadFailed
  | SnapshotPathRejected
  | AuthorSearchConfigurationFailed
  | AuthorSessionStartFailed;

export type AuthorTurnError = ProviderRequestFailed | DraftMalformed;

export interface AuthoringSession {
  readonly initial: AuthorTurn;
  readonly repair: (feedback: string) => Effect.Effect<AuthorTurn, AuthorTurnError>;
}

export interface WalkthroughAuthorShape {
  readonly availableModels: Effect.Effect<readonly AuthorModel[], AuthorDiscoveryFailed>;
  readonly modelPreference: Effect.Effect<
    Option.Option<AuthorModelPreference>,
    AuthorPreferenceReadFailed
  >;
  readonly rememberModel: (model: AuthorModel) => Effect.Effect<void, AuthorPreferenceWriteFailed>;
  readonly loginMethods: Effect.Effect<readonly AuthorLoginMethod[], AuthorDiscoveryFailed>;
  readonly login: (
    method: AuthorLoginMethod,
    interaction: LoginInteraction,
  ) => Effect.Effect<void, LoginFailed | LoginCancelled>;
  readonly start: (
    request: AuthoringRequest,
  ) => Effect.Effect<AuthoringSession, AuthorStartupError | AuthorTurnError, Scope.Scope>;
}

export class WalkthroughAuthor extends Context.Service<WalkthroughAuthor, WalkthroughAuthorShape>()(
  "@balade/WalkthroughAuthor",
) {}
