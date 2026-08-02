/**
 * The HTTP edge of served mode: the prebuilt SPA on `/` with the SPA fallback,
 * four JSON endpoints under `/api`, and a Node server whose lifetime is the
 * caller's scope — closing the scope closes the port.
 *
 * Effect stops here. Everything below answers plain values.
 */

import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/unstable/http";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Answer, Api } from "./api.js";

/** A review tool listens for the reviewer, not for the network. */
const HOST = "127.0.0.1";

export interface ServeOptions {
  /** Directory holding the prebuilt SPA: an `index.html` and its assets. */
  appDir: string;
  /** `0` asks the operating system for a free port. */
  port: number;
  api: Api;
}

/** The prebuilt SPA ships beside the compiled CLI: `dist/cli.js` next to `dist/app/`. */
const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

/** The bundle directory, or `null` when this install carries none. */
export function findAppBundle(): string | null {
  return existsSync(join(APP_DIR, "index.html")) ? APP_DIR : null;
}

/** What `open` prints when the bundle was never built, or never shipped. */
export const APP_BUNDLE_MISSING =
  `balade: no app bundle at ${APP_DIR}. In a checkout, run \`pnpm run build:app\`; ` +
  "in an install, reinstall balade.";

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
      "/api/staleness",
      answering((path) => options.api.staleness(path)),
    ),
    /* The SPA takes `GET /*`. The router prefers a literal path over the
       wildcard, so the four endpoints above win whatever the merge order. */
    HttpStaticServer.layer({ root: options.appDir, spa: true }),
  );

/** The walkthrough a request names, or `null` when it names none. */
const queryPath = Effect.gen(function* () {
  const params = yield* HttpServerRequest.ParsedSearchParams;
  const value = params["path"];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
});

const answering = (answer: (path: string | null) => Answer) =>
  Effect.map(queryPath, (path) => respond(answer(path)));

const putState = (api: Api) =>
  Effect.gen(function* () {
    const path = yield* queryPath;
    const request = yield* HttpServerRequest.HttpServerRequest;
    /* A body that is not JSON and a body that is the wrong JSON fail the caller
       the same way: neither is a review state, and `writeState` says so. */
    const body = yield* Effect.orElseSucceed(request.json, (): unknown => undefined);
    return respond(api.writeState(path, body));
  });

/**
 * `jsonUnsafe` skips the serialisation error channel: every body here is a
 * payload the CLI just built out of strings, numbers and plain objects, so a
 * value JSON cannot take would be a defect, not a request failure.
 */
const respond = (answer: Answer): HttpServerResponse.HttpServerResponse =>
  answer.kind === "json"
    ? HttpServerResponse.jsonUnsafe(answer.body)
    : HttpServerResponse.jsonUnsafe({ error: answer.message }, { status: answer.status });
