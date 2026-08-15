/**
 * The HTTP edge of served mode: the prebuilt SPA on `/` with the SPA fallback,
 * six JSON endpoints under `/api`, and a Node server whose lifetime is the
 * caller's scope — closing the scope closes the port.
 *
 * This is the translation boundary for typed `ApiError` failures.
 */

import { NodeHttpServer } from "@effect/platform-node";
import { Cause, Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { sanitizeTerminalText } from "../terminal.js";
import {
  ApiQaRequestInvalid,
  ApiReviewStateInvalid,
  apiErrorResponse,
  type Api,
  type ApiError,
} from "./api.js";

/** A review tool listens for the reviewer, not for the network. */
const HOST = "127.0.0.1";
const ALLOWED_HOSTS = new Set([HOST, "localhost", "[::1]"]);
const REVIEW_STATE_BODY_LIMIT = FileSystem.MiB(4);
const QA_BODY_LIMIT = FileSystem.KiB(64);

const hostAllowed = (host: string | undefined): boolean =>
  host !== undefined && ALLOWED_HOSTS.has(host.replace(/:\d+$/u, ""));

const protectReviewServer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!hostAllowed(request.headers["host"])) {
        return HttpServerResponse.empty({ status: 403 });
      }
      return HttpServerResponse.setHeader(yield* httpEffect, "X-Frame-Options", "DENY");
    }),
  { global: true },
);

export interface ServeOptions {
  /** Directory holding the prebuilt SPA: an `index.html` and its assets. */
  appDir: string;
  /** `0` asks the operating system for a free port. */
  port: number;
  api: Api;
}

/** The prebuilt SPA ships beside the compiled CLI: `dist/cli.js` next to `dist/app/`. */
const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

export class AppBundleMissing extends Schema.TaggedErrorClass<AppBundleMissing>()(
  "AppBundleMissing",
  { path: Schema.String },
) {
  get note(): string {
    return (
      `balade: no app bundle at ${this.path}. In a checkout, run \`pnpm run build:app\`; ` +
      "in an install, reinstall balade."
    );
  }
}

export class AppBundleReadFailed extends Schema.TaggedErrorClass<AppBundleReadFailed>()(
  "AppBundleReadFailed",
  { path: Schema.String, cause: Schema.Defect() },
) {
  get note(): string {
    return `balade could not inspect the app bundle at ${this.path}.`;
  }
}

/** The required served-app bundle directory. */
export const findAppBundle = Effect.fn("findAppBundle")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const index = path.join(APP_DIR, "index.html");
  return (yield* fs
    .exists(index)
    .pipe(Effect.mapError((cause) => new AppBundleReadFailed({ path: index, cause }))))
    ? APP_DIR
    : yield* new AppBundleMissing({ path: APP_DIR });
});

/** Starts listening and answers the URL. The server closes with the scope. */
export const serve = (options: ServeOptions) =>
  Effect.gen(function* () {
    const server = yield* NodeHttpServer.make(() => createServer(), {
      port: options.port,
      host: HOST,
    });
    const handler = yield* HttpRouter.toHttpEffect(routes(options)).pipe(
      Effect.provide(NodeHttpServer.layerHttpServices),
    );
    yield* server.serve(handler);
    return HttpServer.formatAddress(server.address);
  });

const routes = (options: ServeOptions) =>
  Layer.mergeAll(
    protectReviewServer,
    HttpRouter.add(
      "GET",
      "/api/walkthrough",
      answering((path) => options.api.walkthrough(path)),
    ),
    HttpRouter.add(
      "GET",
      "/api/state",
      answering((path) => options.api.readState(path)),
    ),
    HttpRouter.add("PUT", "/api/state", putState(options.api)),
    HttpRouter.add(
      "GET",
      "/api/qa",
      answering((path) => options.api.readQa(path)),
    ),
    HttpRouter.add("POST", "/api/qa", postQuestion(options.api)),
    HttpRouter.add(
      "GET",
      "/api/staleness",
      answering((path) => options.api.staleness(path)),
    ),
    /* The SPA takes `GET /*`. The router prefers a literal path over the
       wildcard, so the six endpoints above win whatever the merge order. */
    HttpStaticServer.layer({ root: options.appDir, spa: true }),
  );

/** The walkthrough a request names, or `null` when it names none. */
const queryPath = Effect.gen(function* () {
  const params = yield* HttpServerRequest.ParsedSearchParams;
  const value = params["path"];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
});

const answering = (answer: (path: string | null) => Effect.Effect<unknown, ApiError>) =>
  respond(Effect.flatMap(queryPath, answer));

const putState = (api: Api) =>
  respond(
    Effect.gen(function* () {
      const path = yield* queryPath;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* request.text.pipe(
        Effect.provideService(HttpServerRequest.MaxBodySize, REVIEW_STATE_BODY_LIMIT),
        Effect.mapError((cause) => new ApiReviewStateInvalid({ cause })),
      );
      return yield* api.writeState(path, body);
    }),
  );

const postQuestion = (api: Api) =>
  respond(
    Effect.gen(function* () {
      const path = yield* queryPath;
      const request = yield* HttpServerRequest.HttpServerRequest;
      const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return yield* new ApiQaRequestInvalid({
          cause: "Clarification questions require application/json.",
        });
      }
      const body = yield* request.text.pipe(
        Effect.provideService(HttpServerRequest.MaxBodySize, QA_BODY_LIMIT),
        Effect.mapError((cause) => new ApiQaRequestInvalid({ cause })),
      );
      return yield* api.askQa(path, body);
    }),
  );

/** The single success/failure translation for every JSON endpoint. */
const respond = <A, R>(effect: Effect.Effect<A, ApiError, R>) =>
  effect.pipe(
    Effect.matchEffect({
      onFailure: respondError,
      onSuccess: (body) => Effect.succeed(respondJson(body)),
    }),
  );

/**
 * `jsonUnsafe` skips the serialisation error channel: every body here is a
 * payload the CLI just built out of strings, numbers and plain objects, so a
 * value JSON cannot take would be a defect, not a request failure.
 */
const respondJson = <A>(body: A): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(body);

const respondError = Effect.fn("Http.respondError")(function* (error: ApiError) {
  const response = apiErrorResponse(error);
  if (response.status === 500) {
    const context = "path" in error ? `${error._tag}: ${error.path}` : error._tag;
    const cause = "cause" in error ? error.cause : error;
    yield* Effect.logError(
      sanitizeTerminalText(
        `balade review server request failed (${context})\n${Cause.pretty(Cause.fail(cause))}`,
      ),
    );
  }
  return HttpServerResponse.jsonUnsafe({ error: response.message }, { status: response.status });
});
