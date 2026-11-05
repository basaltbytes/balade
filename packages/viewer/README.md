# @balade/viewer

The walkthrough viewer of [balade](https://github.com/basaltbytes/balade) as a
React component. balade is an open-source CLI that turns committed walkthrough
files into interactive pull-request reviews; this package renders a compiled
payload inside your own application.

```sh
npm install @balade/viewer react react-dom effect
```

```tsx
import { WalkthroughView } from "@balade/viewer";
import "@balade/viewer/viewer.css";

export function ReviewPage({ payload }: { payload: unknown }) {
  return <WalkthroughView payload={payload} />;
}
```

React 19, React DOM 19 and Effect 4 are peers. Shiki, Mermaid and Octicons are
regular dependencies, so an application that already uses them shares one
copy; syntax grammars and Mermaid load as separate chunks only when a
walkthrough needs them. The stylesheet is scoped under `.balade-viewer` and uses
`--balade-*` tokens, so it does not change the host page.

Supply a `WalkthroughHost` to persist review marks or answer clarification
questions. `Walkthrough.Root`, `Header`, `Nav`, `Sections` and `Clarifications`
arrange the review in your own layout, and `Diff` renders changed files without
a walkthrough. The [integration guide](https://github.com/basaltbytes/balade/blob/main/docs/viewer.md)
covers host adapters, navigation, theme tokens and CSP. MIT licensed.
