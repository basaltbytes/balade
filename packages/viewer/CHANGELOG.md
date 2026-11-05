# @balade/viewer

## 0.19.0

### Minor Changes

- f95f878: Publish the viewer and the payload contract as separate packages, so an
  application no longer installs the CLI to render or check walkthroughs.
  `@balade/core` holds `decodePayload`, `PAYLOAD_FORMAT`, the contract types,
  `checkAnswer` and `checkAnswerEffect` for payload sources, and
  `clarificationContext`, with no Node built-ins. `@balade/viewer` holds
  `WalkthroughView`, the `Walkthrough` parts, `Diff`, the `WalkthroughHost` types
  and `@balade/viewer/viewer.css`; its API is unchanged from `balade/viewer`.
  React, React DOM and Effect are peers, and Shiki, Mermaid and Octicons are
  dependencies that the host's bundler can share instead of bundled copies. The
  packed viewer is 143 KB instead of shipping 17 MB inside `balade`.
  
  `balade/viewer`, `balade/viewer.css`, `balade/contract` and `balade/answers`
  re-export the new packages for this release and will be removed in the next
  minor version. `balade/viewer` now requires installing `@balade/viewer`
  alongside `balade`. balade moves to the stable Effect 4.1.2 release; library
  callers that provide `liveLayer` or compose the Effect variants need Effect 4.

### Patch Changes

- Updated dependencies [f95f878]
  - @balade/core@0.19.0
