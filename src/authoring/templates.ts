/**
 * The canonical navigation skeleton: five narrative groups the author adapts
 * and prunes, followed by one mandatory review group. Tests parse every
 * template against the real Markdoc config.
 */

export interface AuthoringSectionTemplate {
  readonly group: "Orientation" | "Models" | "Surface" | "Quality" | "Deep dive" | "Full PR diff";
  readonly selectWhen: string;
  readonly template: string;
}

export const AUTHORING_SECTION_TEMPLATES: readonly AuthoringSectionTemplate[] = [
  {
    group: "Orientation",
    selectWhen:
      "Always. State what changed, why a reviewer should care, and the constraint that shapes the implementation.",
    template: `{% group label="Orientation" %}
{% section id="overview" title="Overview" %}
Replace this line with the review frame.
{% /section %}
{% /group %}`,
  },
  {
    group: "Models",
    selectWhen:
      "Use for domain types, persisted state, components, or services whose structure carries the change.",
    template: `{% group label="Models" %}
{% section id="implementation" title="Implementation" %}
Replace this line with the state or component anatomy.
{% /section %}
{% /group %}`,
  },
  {
    group: "Surface",
    selectWhen:
      "Use for behavior that a caller, operator, or user can observe: UI, API, CLI, configuration, or documentation.",
    template: `{% group label="Surface" %}
{% section id="interface" title="Interface" %}
Replace this line with the observable behavior.
{% /section %}
{% /group %}`,
  },
  {
    group: "Quality",
    selectWhen:
      "Use when tests, security, migrations, or translations provide evidence a reviewer needs. Keep each selected topic in its own section.",
    template: `{% group label="Quality" %}
{% section id="proof" title="Proof" %}
Replace this line with the safety or test evidence.
{% /section %}
{% /group %}`,
  },
  {
    group: "Deep dive",
    selectWhen:
      "Use only when one algorithm, lifecycle, state transition, or compatibility boundary needs a slower reading path.",
    template: `{% group label="Deep dive" %}
{% section id="mechanism" title="Mechanism" %}
Replace this line with the detailed reading path.
{% /section %}
{% /group %}`,
  },
  {
    group: "Full PR diff",
    selectWhen:
      "Always, and always last. This unfiltered diff browser lets the reviewer inspect every changed file and mark each one as viewed.",
    template: `{% group label="Full PR diff" %}
{% section id="files" title="Full PR diff" icon="file-diff" %}
{% files /%}
{% /section %}
{% /group %}`,
  },
];

/** The templates as one prompt or skill fragment. */
export const sectionTemplatesText = AUTHORING_SECTION_TEMPLATES.map(
  ({ group, selectWhen, template }) => `### ${group}
${selectWhen}

${template}`,
).join("\n\n");
