import { Result } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { parseAuthorSourcePath } from "../src/pi/source-path.js";

const CREDENTIAL_PATHS = [
  ".env",
  ".env.local",
  ".ENV.PRODUCTION",
  ".npmrc",
  ".netrc",
  "cert.pem",
  "private.key",
  "id_rsa_backup",
  "id_ed25519.pub",
  "id_ecdsa_old",
  "identity.p12",
  "identity.pfx",
  "store.keystore",
  "trust.jks",
  "credentials",
  "credentials.json",
  "secrets.yaml",
  "secret.txt",
  ".aws/config",
  ".ssh/config",
  ".SSH/known_hosts",
  ".gnupg/keyring",
];

describe("authoring source paths", () => {
  it.each([
    "",
    "/etc/passwd",
    "../secret.txt",
    "src/../secret.txt",
    "src\\secret.txt",
    "src//x.ts",
  ])("rejects uncontained path %s", (path) => {
    const parsed = parseAuthorSourcePath(path);
    expect(Result.isFailure(parsed)).toBe(true);
    if (Result.isFailure(parsed)) expect(parsed.failure._tag).toBe("AuthorSourcePathRejected");
  });

  it.each(CREDENTIAL_PATHS)("rejects credential path %s", (path) => {
    const parsed = parseAuthorSourcePath(path);
    expect(Result.isFailure(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      expect(parsed.failure).toMatchObject({
        _tag: "AuthorSourcePathRejected",
        path,
        message: `${path} is not a contained repo-relative path.`,
      });
    }
  });

  it.each(["src/config.ts", "docs/environment.md", "secrets", "nested/.env-example"])(
    "keeps ordinary repository path %s readable",
    (path) => {
      const parsed = parseAuthorSourcePath(path);
      expect(Result.isSuccess(parsed)).toBe(true);
      if (Result.isSuccess(parsed)) expect(parsed.success).toBe(path);
    },
  );

  it("normalizes one leading repository-relative marker", () => {
    const parsed = parseAuthorSourcePath("./src/config.ts");
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isSuccess(parsed)) expect(parsed.success).toBe("src/config.ts");
  });
});
