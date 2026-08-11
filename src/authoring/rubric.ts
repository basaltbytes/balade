/** The four-part writing rubric the evaluator and human review share. */

export interface AuthoringRubricCriterion {
  readonly id: "factual-accuracy" | "section-selection" | "reviewer-usefulness" | "prose-quality";
  readonly question: string;
  readonly pass: string;
  readonly reject: string;
}

export const AUTHORING_RUBRIC: readonly AuthoringRubricCriterion[] = [
  {
    id: "factual-accuracy",
    question: "Can every claim and code reference be confirmed at the pinned commit?",
    pass: "Paths, ranges, boundary echoes, behavior, and stated constraints match inspected evidence.",
    reject:
      "The draft guesses intent, describes code it did not inspect, or uses an unconfirmed range.",
  },
  {
    id: "section-selection",
    question: "Does each narrative section earn its place in the review story?",
    pass: "The narrative follows the behavioral spine and omits files or topics that add no review signal; the required bare full-PR diff remains last.",
    reject:
      "The narrative inventories files, copies all five narrative groups by habit, gives a mechanical change its own mechanism section, or omits, filters, or moves the closing full-PR diff.",
  },
  {
    id: "reviewer-usefulness",
    question: "Can a reviewer use the draft to choose what to inspect and what to challenge?",
    pass: "The draft explains observable behavior, control flow, constraints, and the proof or risk that matters; the reader understands the logic of the solution without opening every code range.",
    reject:
      "The draft paraphrases syntax, repeats the PR title, or hides the decision behind generic praise.",
  },
  {
    id: "prose-quality",
    question: "Can a reader understand the change without prior access to the coding session?",
    pass: "Prose is direct, neutral, concrete, and consistent about technical terms.",
    reject:
      "Prose assumes the reader already knows the code, uses vague claims, or turns headings into marketing copy.",
  },
];

/** The rubric as one prompt or skill fragment. */
export const rubricText = AUTHORING_RUBRIC.map(
  ({ question, pass, reject }) => `- ${question}\n  Pass: ${pass}\n  Reject: ${reject}`,
).join("\n");
