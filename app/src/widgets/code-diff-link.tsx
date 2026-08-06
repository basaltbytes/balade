import { useEffect, useState } from "react";
import { Octicon } from "../ui/octicon";
import { useStrings } from "../ui/strings";

interface DiffTarget {
  readonly prUrl: string;
  readonly file: string;
  readonly line: number;
  readonly href: string;
}

const hexDigest = (digest: ArrayBuffer): string =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

export function CodeDiffLink({ prUrl, file, line }: { prUrl: string; file: string; line: number }) {
  const strings = useStrings();
  const filesUrl = `${prUrl}/files`;
  const [target, setTarget] = useState<DiffTarget | null>(null);
  const href =
    target?.prUrl === prUrl && target.file === file && target.line === line
      ? target.href
      : filesUrl;

  useEffect(() => {
    const subtle = globalThis.crypto?.subtle;
    if (subtle === undefined) return;

    let active = true;
    void subtle.digest("SHA-256", new TextEncoder().encode(file)).then(
      (digest) => {
        if (!active) return;
        setTarget({
          prUrl,
          file,
          line,
          href: `${filesUrl}#diff-${hexDigest(digest)}R${line}`,
        });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [file, filesUrl, line, prUrl]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={strings.openDiffOnGitHub}
      aria-label={strings.openDiffOnGitHub}
      className="text-muted-foreground hover:text-primary focus-visible:text-primary shrink-0"
    >
      <Octicon name="link-external" size={14} />
    </a>
  );
}
