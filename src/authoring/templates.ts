/**
 * The canonical navigation skeleton: five narrative roles the author selects
 * from and names from the change, followed by one mandatory review group.
 * Tests parse every template against the real Markdoc config.
 *
 * A role is not a heading. The templates carry no `{% group %}` wrapper and no
 * `icon`, because both get copied verbatim: earlier packages shipped them and
 * every walkthrough came back with the same five headings and the same icon in
 * the same position, whatever the pull request contained. The author writes the
 * labels, titles and icons for the change in front of them — a role name is
 * available when it fits, not supplied as a default. The closing section is the
 * one fixed subject, so it keeps its group and its icon.
 */

export interface AuthoringSectionTemplate {
  /** What this part of the walkthrough does. It names nothing the reader sees. */
  readonly role: "Orientation" | "Mechanism" | "Models" | "Surface" | "Quality" | "Full PR diff";
  readonly selectWhen: string;
  readonly template: string;
}

export const AUTHORING_SECTION_TEMPLATES: readonly AuthoringSectionTemplate[] = [
  {
    role: "Orientation",
    selectWhen:
      "Always. State what changed, why a reviewer should care, and the constraint that shapes the implementation.",
    template: `{% section id="overview" title="Overview" %}
Replace this line with the review frame.
{% /section %}`,
  },
  {
    role: "Mechanism",
    selectWhen:
      "Use when the change carries an algorithm or non-obvious logic worth explaining. Explain the solution in several sentences, add a mermaid fence when a picture makes the logic clearer, add a pseudo fence for a pseudo-code simplified explaination, then show the code range that proves each critical claim under that claim, in full form or as a collapsed block. Skip this role for a documentation, configuration, or mechanical change.",
    template: `{% section id="mechanism" title="Mechanism" %}
Replace this paragraph with the explanation of the solution: what it does, the inputs it accepts, the decisions it makes, the order of the steps, and the cases it rejects. Add a mermaid fence when a picture makes the logic clearer.

Then state one critical claim per paragraph, and show the code range that proves it under the claim, in full form or pinned with collapsed=true.
{% /section %}`,
  },
  {
    role: "Models",
    selectWhen:
      "Use for domain types, persisted state, components, or services whose structure carries the change.",
    template: `{% section id="implementation" title="Implementation" %}
Replace this line with the state or component anatomy.
{% /section %}`,
  },
  {
    role: "Surface",
    selectWhen:
      "Use for behavior that a caller, operator, or user can observe: UI, API, CLI, configuration, or documentation.",
    template: `{% section id="interface" title="Interface" %}
Replace this line with the observable behavior.
{% /section %}`,
  },
  {
    role: "Quality",
    selectWhen:
      "Use when tests, security, migrations, or translations provide evidence a reviewer needs. Keep each selected topic in its own section.",
    template: `{% section id="proof" title="Proof" %}
Replace this line with the safety or test evidence.
{% /section %}`,
  },
  {
    role: "Full PR diff",
    selectWhen:
      "Always, and always last. This unfiltered diff browser lets the reviewer inspect every changed file and mark each one as viewed. When the pull request touches more than ten files, group that browser by giving the block `{% filegroup /%}` children with labels drawn from the change itself, such as Tests, Traductions, Models, Security, UI, Controllers, or Misc; the groups only partition the diff, so every changed file stays reachable. For a smaller change, drop the children and keep a bare `{% files /%}`.",
    template: `{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files %}
{% filegroup label="Tests" only="**/*.test.ts" /%}
{% filegroup label="UI" only="app/**" /%}
{% filegroup label="Misc" /%}
{% /files %}
{% /section %}
{% /group %}`,
  },
];

/** The templates as one prompt or skill fragment. */
export const sectionTemplatesText = AUTHORING_SECTION_TEMPLATES.map(
  ({ role, selectWhen, template }) => `### ${role}
${selectWhen}

${template}`,
).join("\n\n");
