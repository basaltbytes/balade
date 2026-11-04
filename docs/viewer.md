# Embed a walkthrough

Install `balade`, React 19 and React DOM 19 in your application, then import the
browser entry and its stylesheet:

```tsx
import { WalkthroughView, type WalkthroughHost } from "balade/viewer";
import "balade/viewer.css";

export function ReviewPage({ payload }: { payload: unknown }) {
  return <WalkthroughView payload={payload} />;
}
```

The component checks the payload before rendering it, including the format
version and the HTTP/HTTPS restriction on the PR URL. Invalid data and unsupported
formats show an error in English or French. Use the payload produced by
`compilePayload` or `balade build --format json`.

Review marks live in component memory unless you supply storage. Clarification
controls appear when the host provides that capability:

```ts
const host: WalkthroughHost = {
  reviewState: {
    load: (signal) => reviews.load(signal),
    save: (state, signal) => reviews.save(state, signal),
  },
  clarifications: {
    status: (signal) => questions.status(signal),
    load: (signal) => questions.load(signal),
    ask: (request, signal) => questions.ask(request, signal),
    subscribe: (onChange) => questions.subscribe(onChange),
  },
};
```

Here `reviews` and `questions` are application adapters. All methods return
plain promises. `reviewState.load` returns a `ReviewState` or `null`;
`clarifications.load` returns a `QaState` or `null`. `status` returns
`{ status: "ready" }` or `{ status: "setup-required" }`, and `ask` returns the
updated `QaState`. States must identify the displayed walkthrough, PR and commit.
Answers use the existing `Block` and `QaTurn` contracts and pass through the same
renderers as the document.

Keep the host object stable, for example with `useMemo`, and honour the supplied
abort signals. Review writes run in order. `subscribe` returns a cleanup function;
when omitted, the viewer polls `load` every 1.5 seconds. A subscription should
publish each updated state, including transitions from pending to answered or
failed. Reject `ask` with `new ClarificationAgentUnavailable()` when agent setup
fails, or `new ClarificationGenerationChanged()` when the request names an older
generation. Both errors are exported from `balade/viewer`.

Review-storage failures show a persistence badge and log the failed operation
and error tag to the browser console. Stored state and host error contents are
excluded from those diagnostics.

## Compose the page

Place the parts anywhere beneath `Walkthrough.Root`. A scroll container may sit
outside it:

```tsx
import { useRef, useState } from "react";
import { Walkthrough, type WalkthroughHost } from "balade/viewer";

export function Review({ payload, host }: { payload: unknown; host: WalkthroughHost }) {
  const scrollRoot = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState("");
  return (
    <div ref={scrollRoot} style={{ height: 700, overflow: "auto" }}>
      <Walkthrough.Root
        payload={payload}
        host={host}
        headDistance={0}
        section={section}
        onSectionChange={setSection}
        scrollRoot={scrollRoot}
      >
        <Walkthrough.Header />
        <div className="review-columns">
          <aside><Walkthrough.Nav /></aside>
          <article><Walkthrough.Sections /></article>
          <aside><Walkthrough.Clarifications /></aside>
        </div>
      </Walkthrough.Root>
    </div>
  );
}
```

`WalkthroughView` assembles the responsive layout, including compact navigation
and a clarification drawer. Navigation and split diffs adapt to the viewer’s
width. Drawers stay within its visible scrolling area. The `Clarifications` part defaults to an inline list;
pass `layout="drawer"` to use the overlay. Omit `section` for automatic section
tracking, or control it through `section` and `onSectionChange`. Without
`scrollRoot`, tracking uses the viewport. `headDistance` overrides the distance
recorded in the payload.

Navigation stays inside the component's sections. The viewer leaves the page
title, HTML attributes, URL and history to your app; use `onSectionChange` if you
want to update your router. Section IDs include an instance prefix. For separate
server-rendered React roots, give each root a distinct React `identifierPrefix`.

## Show changed files without a walkthrough

`Diff` renders a list of changed files with the same diff browser as a
walkthrough's files sections. It needs no payload:

```tsx
import { Diff, type DiffFile } from "balade/viewer";
import "balade/viewer.css";

// `GitHubFile` is an item from GitHub's "List pull request files" endpoint.
function toDiffFile(file: GitHubFile): DiffFile {
  const status =
    file.status === "added" || file.status === "removed" || file.status === "renamed"
      ? file.status
      : "modified";
  return {
    path: file.filename,
    ...(file.previous_filename !== undefined ? { oldPath: file.previous_filename } : {}),
    status,
    additions: file.additions,
    deletions: file.deletions,
    patch:
      file.patch !== undefined
        ? { kind: "text", text: file.patch }
        : status === "renamed" && file.changes === 0
          ? { kind: "text", text: "" }
          : { kind: "omitted" },
    test: /(^|\/)tests?\//.test(file.filename),
  };
}

export function Changes({ files }: { files: GitHubFile[] }) {
  const navigate = useNavigate(); // your router's navigation
  return (
    <Diff
      files={files.map(toDiffFile)}
      fileHref={(file) => `/files/${encodeURIComponent(file.path)}`}
      onFileOpen={(file, event) => {
        event.preventDefault();
        navigate(`/files/${encodeURIComponent(file.path)}`);
      }}
    />
  );
}
```

Each `DiffFile` has a `patch`:

- `{ kind: "text", text }` holds the unified diff, with or without the
  `---`/`+++` header. Add `truncated: true` when the text stops early; the row
  shows the partial diff and a notice. Text with no hunk, such as a pure rename,
  shows "No content changes".
- `{ kind: "binary" }` shows a binary-file notice.
- `{ kind: "omitted" }` shows that no diff is available, for example when GitHub
  leaves out the patch of a large file.

Files start collapsed. Pass `defaultExpanded` to open every file except those
marked `generated`. `test` and `generated` add a label to the file's row.
`fileHref` and `onFileOpen` add a link to the host's own file view. Links render
only for HTTP, HTTPS and relative URLs. Without a usable `fileHref`, the
callback gets a button instead. Both callbacks receive the objects you passed.
`lang` sets the chrome language, `"en"` by default, and `className` and `style`
apply to the root, as for `Walkthrough.Root`.

The component checks `files` before rendering, and shows an error for data that
does not match `DiffFile`. It has no review marks or clarification controls,
and it makes no requests.

## Theme and browser policy

The stylesheet scopes its selectors to `.balade-viewer` and imports no Tailwind
preflight. Pass `className` or `style` to either root component to map your theme:

```css
.balade-viewer.review-theme {
  --balade-color-background: var(--app-surface);
  --balade-color-foreground: var(--app-text);
  --balade-color-primary: var(--app-accent);
  --balade-color-border: var(--app-border);
  --balade-font-sans: var(--app-font);
}
```

The main tokens are `--balade-color-background`, `foreground`, `card`, `primary`,
`primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `border`, `ring`, `added`, `removed`, `modified` and `done`
(each color name takes the `--balade-color-` prefix). Font and sizing tokens are
`--balade-font-sans`, `--balade-font-mono`, `--balade-radius-md`,
`--balade-radius-lg`, `--balade-text-prose`, `--balade-text-section` and
`--balade-text-page`. The supplied palette is dark.

The viewer works with this host CSP:

```text
script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:
```

Serve your bundler's generated script and CSS assets from your origin. Mermaid
and syntax grammars load as separate chunks. React and React DOM are peers;
rendering dependencies, including Effect, ship inside the viewer bundle. Your
application can use a different Effect version.

The viewer makes data requests only through the host. It neither chooses API
paths nor reads browser storage. Mermaid diagrams that contain resource syntax,
HTML, CSS escapes or block comments or encoded entities show their source as text, because those
forms can trigger loads while Mermaid measures the diagram. Keep labels as plain
text and diagrams self-contained.
