/** The source-path policy shared by pinned and base authoring reads. */

import { Result, Schema } from "effect";
import { isContainedRepoRelativePath } from "../contract/paths.js";

const CREDENTIAL_FILE_BASENAME_PATTERNS = [
  /^\.env(?:\..*)?$/iu,
  /^\.npmrc$/iu,
  /^\.netrc$/iu,
  /\.(?:pem|key)$/iu,
  /\.(?:p12|pfx|keystore|jks)$/iu,
  /^id_(?:rsa|ed25519|ecdsa).*$/iu,
  /^credentials(?:\..*)?$/iu,
  /^secrets?\..*$/iu,
];
const CREDENTIAL_DIRECTORY_NAMES = new Set([".aws", ".ssh", ".gnupg"]);

const AuthorSourcePath = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isReadableRepositoryPath)),
  Schema.brand("@balade/AuthorSourcePath"),
);
export type AuthorSourcePath = typeof AuthorSourcePath.Type;

export class AuthorSourcePathRejected extends Schema.TaggedErrorClass<AuthorSourcePathRejected>()(
  "AuthorSourcePathRejected",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class AuthorSourceUnavailable extends Schema.TaggedErrorClass<AuthorSourceUnavailable>()(
  "AuthorSourceUnavailable",
  {
    path: Schema.String,
    pin: Schema.String,
    message: Schema.String,
  },
) {}

const decodeAuthorSourcePath = Schema.decodeUnknownResult(AuthorSourcePath);

/** Parse an untrusted tool argument into a contained, non-credential source path. */
export function parseAuthorSourcePath(
  sourcePath: string,
): Result.Result<AuthorSourcePath, AuthorSourcePathRejected> {
  const normalized = sourcePath.replace(/^\.\//u, "");
  return decodeAuthorSourcePath(normalized).pipe(
    Result.mapError(
      () =>
        new AuthorSourcePathRejected({
          path: sourcePath,
          message: `${sourcePath} is not a contained repo-relative path.`,
        }),
    ),
  );
}

function isReadableRepositoryPath(sourcePath: string): boolean {
  const segments = sourcePath.split("/");
  const basename = segments.at(-1) ?? "";
  return !(
    !isContainedRepoRelativePath(sourcePath) ||
    segments
      .slice(0, -1)
      .some((segment) => CREDENTIAL_DIRECTORY_NAMES.has(segment.toLowerCase())) ||
    CREDENTIAL_FILE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))
  );
}
