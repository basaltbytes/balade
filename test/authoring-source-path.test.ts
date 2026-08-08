import { describe, expect, it } from "@effect/vitest";
import { repositoryPath } from "../src/pi/session.js";

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
  it.each(CREDENTIAL_PATHS)("rejects credential path %s", (path) => {
    expect(() => repositoryPath(path)).toThrow(`${path} is not a contained repo-relative path.`);
  });

  it.each(["src/config.ts", "docs/environment.md", "secrets", "nested/.env-example"])(
    "keeps ordinary repository path %s readable",
    (path) => {
      expect(repositoryPath(path)).toBe(path);
    },
  );
});
