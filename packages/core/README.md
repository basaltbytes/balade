# @balade/core

The payload contract and portable answer check of
[balade](https://github.com/basaltbytes/balade), an open-source CLI that turns
committed walkthrough files into interactive pull-request reviews.

This package runs in browsers and on servers. It uses no Node built-ins and
does not install the balade CLI or its agent runtime. Dependencies: Effect 4
(a peer), Markdoc and YAML.

```sh
npm install @balade/core effect
```

```ts
import { checkAnswer, clarificationContext, decodePayload, PAYLOAD_FORMAT } from "@balade/core";
import { Effect } from "effect";

// A payload produced by `balade build --format json` or `compilePayload`.
const payload = await Effect.runPromise(decodePayload(storedJson));

// Context for your own agent, then a check of the Markdoc answer it wrote.
const task = clarificationContext({ walkthrough: payload, anchor, question, turns });
const answer = await checkAnswer(markdocBody, { _tag: "Payload", payload });
// { _tag: "Accepted", blocks } or { _tag: "Rejected", diagnostics }
```

`decodePayload` returns an Effect that strictly checks the payload and fails
with `PayloadFormatUnsupported` for another format version or `PayloadInvalid`
for malformed data. `checkAnswerEffect` is the Effect form of `checkAnswer`.
Contract types such as `Payload`, `Block`, `QaTurn` and `ReviewState` are
exported as TypeScript types.

See the [balade README](https://github.com/basaltbytes/balade#library) for
compiling payloads and the full answer workflow. MIT licensed.
