/** Versions among `packages` that `registry` does not serve as `<name>/<version>`. */
export function unpublishedPackages(
  packages: ReadonlyArray<{ readonly name: string; readonly version: string }>,
  registry: string | URL,
): Promise<string[]>;
