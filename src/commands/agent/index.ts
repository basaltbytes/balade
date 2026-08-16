/** `balade agent`: configure the provider and model used by every agent-powered feature. */

import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { AgentModelManager, modelSelectionFromFlags } from "../../agent/model.js";
import { agentModelErrorMessage } from "../../agent/terminal.js";
import { stdoutTheme, stopMessage, writeStdout } from "../../terminal.js";

const provider = Flag.string("provider").pipe(
  Flag.withDescription("Agent provider id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const model = Flag.string("model").pipe(
  Flag.withDescription("Agent model id; partial or unavailable selections open the picker"),
  Flag.optional,
);

const setupCommand = Command.make("setup", { provider, model }, (config) =>
  Effect.gen(function* () {
    const manager = yield* AgentModelManager;
    yield* manager.configure(modelSelectionFromFlags(config.provider, config.model));
    writeStdout(`${stdoutTheme.ok("Agent setup complete.")}\n`);
  }).pipe(Effect.catch((error) => Effect.sync(() => stopMessage(agentModelErrorMessage(error))))),
).pipe(Command.withDescription("Authenticate and choose the model used by generation and Q&A"));

export const agentCommand = Command.make("agent").pipe(
  Command.withDescription("Manage the local agent provider and model"),
  Command.withSubcommands([setupCommand]),
);
