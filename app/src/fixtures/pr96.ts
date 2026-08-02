/* The pr-96 walkthrough, hand-written against the resolved-payload contract.
   It is the vite dev database and the visual reference for review; the CLI
   produces the same shape from a Markdoc file plus git.

   Hashes stand in for the CLI's sha256 values: the renderer only ever compares
   them for equality. */

import type {
  Block,
  FileDiff,
  FileEntry,
  FileStatus,
  Inline,
  NavNode,
  Payload,
  Section,
} from "../contract";

const B = (...xs: Inline[]): Inline => ({ b: xs });
const I = (...xs: Inline[]): Inline => ({ i: xs });
const C = (s: string): Inline => ({ c: s });
const M = (s: string): Inline => ({ m: s });

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/* ------------------------------------------------------------------ */
/* Files: a hunk body plus the untouched head/tail, so the diff browser */
/* has real context to expand into.                                     */
/* ------------------------------------------------------------------ */

interface Draft {
  path: string;
  oldPath?: string;
  status: FileStatus;
  lang: string;
  ref?: string;
  why?: Inline;
  hash: string;
  /** Lines before the hunk, identical on both sides. */
  head?: string[];
  /** Hunk body; every line prefixed with " ", "+" or "-". */
  hunk: string[];
  /** Lines after the hunk, identical on both sides. */
  tail?: string[];
}

const strip = (line: string): string => line.slice(1);

function build(draft: Draft): FileEntry {
  const head = draft.head ?? [];
  const tail = draft.tail ?? [];
  const kept = draft.hunk.filter((line) => !line.startsWith("+")).map(strip);
  const next = draft.hunk.filter((line) => !line.startsWith("-")).map(strip);
  const additions = draft.hunk.filter((line) => line.startsWith("+")).length;
  const deletions = draft.hunk.filter((line) => line.startsWith("-")).length;

  const oldLines = draft.status === "A" ? null : [...head, ...kept, ...tail];
  const newLines = draft.status === "D" ? null : [...head, ...next, ...tail];
  const oldStart = oldLines === null ? 0 : head.length + 1;
  const newStart = newLines === null ? 0 : head.length + 1;
  const oldCount = oldLines === null ? 0 : kept.length;
  const newCount = newLines === null ? 0 : next.length;

  const from = draft.oldPath ?? draft.path;
  const banner =
    draft.status === "A"
      ? `new file mode 100644\n--- /dev/null\n+++ b/${draft.path}`
      : draft.status === "D"
        ? `deleted file mode 100644\n--- a/${from}\n+++ /dev/null`
        : draft.status === "R"
          ? `similarity index 84%\nrename from ${from}\nrename to ${draft.path}\n--- a/${from}\n+++ b/${draft.path}`
          : `--- a/${from}\n+++ b/${draft.path}`;

  const diff: FileDiff = {
    unified: [
      `diff --git a/${from} b/${draft.path}`,
      banner,
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...draft.hunk,
    ].join("\n"),
    oldContent: oldLines === null ? null : oldLines.join("\n"),
    newContent: newLines === null ? null : newLines.join("\n"),
  };

  return {
    path: draft.path,
    ...(draft.oldPath !== undefined ? { oldPath: draft.oldPath } : {}),
    status: draft.status,
    additions,
    deletions,
    ...(draft.ref !== undefined ? { ref: draft.ref } : {}),
    ...(draft.why !== undefined ? { why: draft.why } : {}),
    hash: draft.hash,
    lang: draft.lang,
    diff,
  };
}

const POOL_MODEL_LINES = [
  `class PlanningPoolItem(models.Model):`,
  `    _name = "planning.pool.item"`,
  `    _auto = False                       # SQL view, no managed table`,
  `    _order = "project_id, month, product_id, role_id, employee_id, id"`,
  `    _rec_name = "name"`,
  ``,
  `    allocation_id = fields.Many2one("planning.allocation", string="Source Allocation", readonly=True)`,
  `    total = fields.Float(compute="_compute_quantities", string="Total")`,
  `    placed = fields.Float(compute="_compute_quantities", string="Already Planned")`,
  `    remaining = fields.Float(compute="_compute_quantities", string="Remaining to Schedule")`,
  ``,
  `    def init(self):`,
  `        drop_view_if_exists(self.env.cr, self._table)`,
  `        self.env.cr.execute(SQL(`,
  `            """`,
  `            CREATE OR REPLACE VIEW %s AS (`,
  `                SELECT allocation.id AS id, allocation.id AS allocation_id, ...`,
  `                FROM planning_allocation allocation`,
  `                WHERE allocation.status = 'converted' AND allocation.active IS TRUE`,
  `            )`,
  `            """,`,
  `            SQL.identifier(self._table),`,
  `        ))`,
  ``,
  `    @api.depends("allocation_id.quantity", "allocation_id.quantity_hours",`,
  `                 "allocation_id.planning_slot_ids.allocated_hours",`,
  `                 "allocation_id.planning_slot_ids.state")`,
  `    def _compute_quantities(self):`,
  `        placed = self.mapped("allocation_id")._planning_placed_hours_by_id()`,
  `        for item in self:`,
  `            a = item.allocation_id`,
  `            placed_hours = placed.get(a.id, 0.0)`,
  `            item.total = a.quantity`,
  `            item.placed = a._hours_to_quantity(placed_hours, a.quantity_unit)`,
  `            item.remaining = a._hours_to_quantity(max(a.quantity_hours - placed_hours, 0.0), a.quantity_unit)`,
];

const ALLOC_AGGREGATOR_LINES = [
  `    def _planning_placed_hours_by_id(self):`,
  `        """Shared aggregator — reused by planning.pool.item._compute_quantities."""`,
  `        allocation_ids = [a.id for a in self if isinstance(a.id, int)]`,
  `        if not allocation_ids:`,
  `            return {}`,
  `        grouped_hours = self.env["planning.slot"].sudo()._read_group(`,
  `            [("allocation_id", "in", allocation_ids), ("state", "!=", "cancelled")],`,
  `            ["allocation_id"],`,
  `            ["allocated_hours:sum"],`,
  `        )`,
  `        return {a.id: hours or 0.0 for a, hours in grouped_hours}`,
];

const SLOT_LINK_LINES = [
  `class PlanningSlot(models.Model):`,
  `    _inherit = "planning.slot"`,
  `    _check_company_auto = True`,
  ``,
  `    allocation_id = fields.Many2one(`,
  `        "planning.allocation",`,
  `        string="Source Allocation",`,
  `        domain=[("status", "=", "converted"), ("active", "=", True)],`,
  `        index=True, tracking=True, check_company=True,`,
  `        ondelete="set null",            # detach, never cascade-delete shifts`,
  `    )`,
  ``,
  `    @api.constrains("allocation_id")`,
  `    def _check_source_allocation_is_confirmed(self):`,
  `        for slot in self.filtered("allocation_id"):`,
  `            if slot.allocation_id.status != "converted" or not slot.allocation_id.active:`,
  `                raise ValidationError(_("Source allocations must be active converted allocations."))`,
];

const PROJECT_ACTION_LINES = [
  `    def action_open_planning_pool_items(self):`,
  `        self.ensure_one()`,
  `        action = self.env["ir.actions.actions"]._for_xml_id("acme_planning.action_planning_pool_item")`,
  `        action["domain"] = [("project_id", "=", self.id)]`,
  `        action["context"] = {"search_default_group_by_month": 1}`,
  `        return action`,
];

const POOL_ACTION_XML_LINES = [
  `<record id="action_planning_pool_item" model="ir.actions.act_window">`,
  `    <field name="name">Remaining to Schedule</field>`,
  `    <field name="res_model">planning.pool.item</field>`,
  `    <field name="view_mode">list,form</field>`,
  `    <field name="search_view_id" ref="view_planning_pool_item_search"/>`,
  `</record>`,
];

const SMART_BUTTON_XML_LINES = [
  `<button class="oe_stat_button" type="object"`,
  `        name="action_open_planning_pool_items"`,
  `        icon="fa-calendar-check-o"`,
  `        groups="acme_planning.group_planning_employee"`,
  `        invisible="planning_pool_item_count == 0">`,
  `    <field name="planning_pool_item_count" widget="statinfo" string="Remaining to Schedule"/>`,
  `</button>`,
];

const RULES_XML_LINES = [
  `<record id="planning_pool_item_rule_employee_company" model="ir.rule">`,
  `    <field name="name">Planning Pool Item: employee company items</field>`,
  `    <field name="model_id" ref="model_planning_pool_item"/>`,
  `    <field name="domain_force">[('company_id', 'in', company_ids + [False])]</field>`,
  `    <field name="groups" eval="[(4, ref('group_planning_employee'))]"/>`,
  `    <field name="perm_read" eval="True"/>`,
  `    <field name="perm_write" eval="False"/>`,
  `    <field name="perm_create" eval="False"/>`,
  `    <field name="perm_unlink" eval="False"/>`,
  `</record>`,
];

const files: FileEntry[] = [
  build({
    path: "addons/acme_planning/models/planning_pool_item.py",
    status: "A",
    lang: "python",
    ref: "m-pool",
    hash: "sha256:f1a0c7d2",
    hunk: [
      `+from odoo import api, fields, models`,
      `+from odoo.tools import SQL, drop_view_if_exists`,
      `+`,
      `+`,
      ...POOL_MODEL_LINES.map((line) => `+${line}`),
    ],
  }),
  build({
    path: "addons/acme_planning/models/planning_allocation.py",
    status: "M",
    lang: "python",
    ref: "m-alloc",
    hash: "sha256:9c3e6b41",
    head: [
      `from odoo import api, fields, models`,
      ``,
      ``,
      `class PlanningAllocation(models.Model):`,
      `    _inherit = "planning.allocation"`,
      ``,
      `    quantity = fields.Float(string="Charge")`,
      `    quantity_unit = fields.Selection([("days", "Days"), ("hours", "Hours")], default="days")`,
    ],
    hunk: [
      `-    planned_hours = fields.Float(string="Planned", store=True)`,
      `+    planning_slot_ids = fields.One2many("planning.slot", "allocation_id", readonly=True)`,
      `+    planned_quantity = fields.Float(compute="_compute_planning_consumption")`,
      `+    planned_hours = fields.Float(compute="_compute_planning_consumption")`,
      `+    remaining_quantity = fields.Float(compute="_compute_planning_consumption")`,
      `+    remaining_hours = fields.Float(compute="_compute_planning_consumption")`,
      ``,
      `+    @api.depends("quantity_hours", "planning_slot_ids.allocated_hours", "planning_slot_ids.state")`,
      `+    def _compute_planning_consumption(self):`,
      `+        placed = self._planning_placed_hours_by_id()`,
      `+        for allocation in self:`,
      `+            hours = placed.get(allocation.id, 0.0)`,
      `+            allocation.planned_hours = hours`,
      `+            allocation.remaining_hours = max(allocation.quantity_hours - hours, 0.0)`,
      `+`,
      ...ALLOC_AGGREGATOR_LINES.map((line) => `+${line}`),
    ],
    tail: [
      ``,
      `    def _hours_to_quantity(self, hours, unit):`,
      `        return hours / 8.0 if unit == "days" else hours`,
    ],
  }),
  build({
    path: "addons/acme_planning/models/planning_slot.py",
    status: "M",
    lang: "python",
    ref: "m-slot",
    hash: "sha256:41bd90ee",
    head: [
      `from odoo import _, api, fields, models`,
      `from odoo.exceptions import ValidationError`,
      ``,
      ``,
    ],
    hunk: [
      `-class PlanningSlot(models.Model):`,
      `-    _inherit = "planning.slot"`,
      ...SLOT_LINK_LINES.map((line) => `+${line}`),
    ],
    tail: [
      ``,
      `    def name_get(self):`,
      `        return [(slot.id, slot.display_name) for slot in self]`,
    ],
  }),
  build({
    path: "addons/acme_planning/models/project_project.py",
    status: "M",
    lang: "python",
    ref: "m-project",
    hash: "sha256:70c4aa18",
    head: [
      `from odoo import api, fields, models`,
      ``,
      ``,
      `class ProjectProject(models.Model):`,
      `    _inherit = "project.project"`,
      ``,
    ],
    hunk: [
      `+    planning_pool_item_count = fields.Integer(`,
      `+        compute="_compute_planning_pool_item_count",`,
      `+        groups="acme_planning.group_planning_employee",`,
      `+    )`,
      `+`,
      `+    def _compute_planning_pool_item_count(self):`,
      `+        grouped = self.env["planning.pool.item"]._read_group(`,
      `+            [("project_id", "in", self.ids)], ["project_id"], ["__count"],`,
      `+        )`,
      `+        counts = {project.id: count for project, count in grouped}`,
      `+        for project in self:`,
      `+            project.planning_pool_item_count = counts.get(project.id, 0)`,
      `+`,
      ...PROJECT_ACTION_LINES.map((line) => `+${line}`),
    ],
  }),
  build({
    path: "addons/acme_planning/views/planning_pool_item_views.xml",
    status: "A",
    lang: "xml",
    ref: "views",
    hash: "sha256:2b7f10ac",
    hunk: [
      `+<?xml version="1.0" encoding="utf-8"?>`,
      `+<odoo>`,
      ...POOL_ACTION_XML_LINES.map((line) => `+    ${line}`),
      `+</odoo>`,
    ],
  }),
  build({
    path: "addons/acme_planning/views/planning_slot_views.xml",
    status: "M",
    lang: "xml",
    ref: "views",
    hash: "sha256:cc51d3a9",
    head: [`<?xml version="1.0" encoding="utf-8"?>`, `<odoo>`],
    hunk: [
      `     <record id="view_planning_slot_form" model="ir.ui.view">`,
      `         <field name="arch" type="xml">`,
      `-            <field name="project_id"/>`,
      `+            <field name="project_id"/>`,
      `+            <field name="allocation_id" options="{'no_create': True}"/>`,
      `         </field>`,
      `     </record>`,
    ],
    tail: [`</odoo>`],
  }),
  build({
    path: "addons/acme_planning/views/project_project_views.xml",
    status: "M",
    lang: "xml",
    ref: "views",
    hash: "sha256:5e8a2f04",
    head: [
      `<?xml version="1.0" encoding="utf-8"?>`,
      `<odoo>`,
      `    <record id="view_project_form" model="ir.ui.view">`,
      `        <field name="arch" type="xml">`,
      `            <div name="button_box" position="inside">`,
    ],
    hunk: SMART_BUTTON_XML_LINES.map((line) => `+                ${line}`),
    tail: [`            </div>`, `        </field>`, `    </record>`, `</odoo>`],
  }),
  build({
    path: "addons/acme_planning/security/planning_rules.xml",
    status: "M",
    lang: "xml",
    ref: "security",
    hash: "sha256:aa0e77b3",
    head: [`<?xml version="1.0" encoding="utf-8"?>`, `<odoo>`],
    hunk: RULES_XML_LINES.map((line) => `+    ${line}`),
    tail: [`</odoo>`],
  }),
  build({
    path: "addons/acme_planning/security/ir.model.access.csv",
    status: "M",
    lang: "csv",
    ref: "security",
    hash: "sha256:31d9c520",
    head: [`id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink`],
    hunk: [
      `+access_planning_pool_item_employee,planning.pool.item employee,model_planning_pool_item,group_planning_employee,1,0,0,0`,
      `+access_planning_pool_item_planner,planning.pool.item planner,model_planning_pool_item,group_planning_planner,1,0,0,0`,
      `+access_planning_pool_item_manager,planning.pool.item manager,model_planning_pool_item,group_planning_manager,1,0,0,0`,
    ],
  }),
  build({
    path: "addons/acme_planning/tests/test_planning_pool_item.py",
    status: "A",
    lang: "python",
    ref: "tests",
    hash: "sha256:6f2c8801",
    hunk: [
      `+from odoo.exceptions import ValidationError`,
      `+from odoo.tests.common import TransactionCase`,
      `+`,
      `+`,
      `+class TestPlanningPoolItem(TransactionCase):`,
      `+    def test_pool_grain(self):`,
      `+        self.assertEqual(len(self.env["planning.pool.item"].search([])), 1)`,
      `+`,
      `+    def test_live_consumption(self):`,
      `+        slot = self._make_slot(hours=16.0)`,
      `+        self.assertEqual(self.pool_item.remaining_hours, 24.0)`,
      `+        slot.unlink()`,
      `+        self.assertEqual(self.pool_item.remaining_hours, 40.0)`,
    ],
  }),
  build({
    path: "addons/acme_planning/i18n/fr.po",
    status: "M",
    lang: "po",
    ref: "i18n",
    hash: "sha256:b41f0d6a",
    head: [`# Translation of Odoo Server.`, `msgid ""`, `msgstr ""`, ``],
    hunk: [
      `+#. module: acme_planning`,
      `+#: model:ir.model.fields,field_description:acme_planning.field_planning_pool_item__remaining`,
      `+msgid "Remaining to Schedule"`,
      `+msgstr "Reste à planifier"`,
    ],
  }),
  build({
    path: "addons/acme_planning/legacy/pool_snapshot.py",
    status: "D",
    lang: "python",
    why: [
      "The nightly snapshot table it maintained is exactly the second charge store ",
      C("planning.pool.item"),
      " removes.",
    ],
    hash: "sha256:d0be4411",
    hunk: [
      `-class PoolSnapshot(models.Model):`,
      `-    _name = "planning.pool.snapshot"`,
      `-`,
      `-    remaining = fields.Float(store=True)`,
      `-`,
      `-    @api.model`,
      `-    def _cron_rebuild(self):`,
      `-        self.search([]).unlink()`,
      `-        self._rebuild_from_allocations()`,
    ],
  }),
];

/* A binary file exercises the `diff: null` branch of the browser. */
files.push({
  path: "addons/acme_planning/static/description/icon.png",
  status: "M",
  additions: 0,
  deletions: 0,
  hash: "sha256:ee00ff12",
  lang: "text",
  diff: null,
});

const additions = files.reduce((sum, file) => sum + file.additions, 0);
const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

/* ------------------------------------------------------------------ */
/* Nav                                                                 */
/* ------------------------------------------------------------------ */

const nav: NavNode[] = [
  {
    kind: "group",
    label: "Orientation",
    children: [
      { kind: "section", label: "Overview", icon: "list-unordered", ref: "overview" },
      { kind: "section", label: "Why this PR exists", icon: "git-compare", ref: "mental-model" },
      { kind: "section", label: "Model map", icon: "git-branch", ref: "map" },
    ],
  },
  {
    kind: "group",
    label: "Models",
    children: [
      { kind: "file", label: "planning_pool_item.py", ref: "m-pool", status: "A" },
      { kind: "file", label: "planning_allocation.py", ref: "m-alloc", status: "M" },
      { kind: "file", label: "planning_slot.py", ref: "m-slot", status: "M" },
      { kind: "file", label: "project_project.py", ref: "m-project", status: "M" },
    ],
  },
  {
    kind: "group",
    label: "Surface",
    children: [
      { kind: "section", label: "Views & intent", icon: "table", ref: "views" },
      { kind: "section", label: "Wizards", icon: "gear", ref: "wizards" },
      { kind: "section", label: "Security", icon: "shield-lock", ref: "security" },
    ],
  },
  {
    kind: "group",
    label: "Quality",
    children: [
      { kind: "section", label: "Tests", icon: "beaker", ref: "tests" },
      { kind: "section", label: "Translations", icon: "globe", ref: "i18n" },
    ],
  },
  {
    kind: "group",
    label: "Deep dive",
    children: [
      { kind: "section", label: "Patterns", icon: "light-bulb", ref: "patterns" },
      { kind: "section", label: "Files changed", icon: "file-diff", ref: "files" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const poolModelBlock: Block = {
  b: "code",
  file: "addons/acme_planning/models/planning_pool_item.py",
  from: 5,
  to: 4 + POOL_MODEL_LINES.length,
  lang: "python",
  view: "change",
  lines: POOL_MODEL_LINES,
  changed: range(5, 4 + POOL_MODEL_LINES.length),
  mark: range(16, 27),
  expect: { value: "class PlanningPoolItem", status: "ok" },
};

const sections: Section[] = [
  {
    id: "overview",
    title: "Overview",
    icon: "list-unordered",
    hash: "sha256:sec-overview-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "Adds ",
              C("planning.pool.item"),
              ", a read-only SQL-view lens over active ",
              B("Converted"),
              " allocations. Each pool item keeps allocation grain and exposes ",
              B("total"),
              ", ",
              B("already planned"),
              " and ",
              B("remaining"),
              " charge from the source allocation plus its non-cancelled linked ",
              C("planning.slot"),
              " rows. Closes #59.",
            ],
          },
        ],
      },
      {
        b: "cards",
        cols: 3,
        items: [
          {
            icon: "database",
            title: "One new model",
            body: [
              [
                C("planning.pool.item"),
                " — an ",
                C("_auto=False"),
                " SQL view. No new table, no second copy of the charge.",
              ],
            ],
          },
          {
            icon: "link",
            title: "One new link",
            body: [
              [
                C("planning.slot.allocation_id"),
                " lets a shift ",
                I("consume"),
                " a source allocation. That link is the whole engine.",
              ],
            ],
          },
          {
            icon: "graph",
            title: "Derived readings",
            body: [
              [
                "total / placed / remaining are ",
                B("computed"),
                " on the fly from linked slots — never stored, never decremented.",
              ],
            ],
          },
        ],
      },
    ],
  },

  {
    id: "mental-model",
    title: "Why this PR exists",
    icon: "git-compare",
    hash: "sha256:sec-mental-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "Reviewing this with a queue behind you? The diff is wider than the idea. Here is the idea.",
            ],
          },
          {
            p: [
              "When a quote is confirmed, the workload behind it becomes real but unscheduled. A line might read ",
              I("Dana Lopez owes Project Atlas six days of site surveys in March 2027"),
              ": agreed and sold, sitting on zero calendars. Someone still has to drop those days onto actual dates, and until this PR no screen told them how much confirmed work was waiting for one.",
            ],
          },
        ],
      },
      {
        b: "callout",
        tone: "key",
        body: [
          B("“Shared pool”"),
          " is the team’s name for it: the pile of confirmed-but-unscheduled work. Open a confirmed project, click ",
          B("Remaining to Schedule"),
          ", and you get one row per chunk of it: ",
          M("Dana Lopez · Project Atlas · March 2027 · 6 d total · 4 placed · 2 left"),
          ". The planner works that list down to zero.",
        ],
      },
      {
        b: "md",
        nodes: [
          { h: "The one thing to check the rest of the diff against" },
          {
            p: [
              "The pool stores none of those numbers. “2 left” is not a column that gets decremented when a shift appears; it is ",
              C("max(total − placed, 0)"),
              ", recomputed the instant you read it, where ",
              C("placed"),
              " is the summed hours of every shift pointing back at that same confirmed allocation.",
            ],
          },
          {
            list: [
              ["Create a shift and the remaining drops."],
              ["Resize, cancel or delete it and the figure tracks it."],
              ["Hand it to another allocation and both figures move."],
            ],
          },
        ],
      },
      {
        b: "flow",
        steps: [
          { body: ["CRM opportunity"] },
          { body: ["allocation"], tag: "forecast" },
          { body: ["quote confirmed"], tag: "converted" },
          { body: ["pool row shows up"] },
          { body: ["planner places shifts"] },
          { body: ["2 left → 0"] },
        ],
      },
      {
        b: "md",
        nodes: [
          { h: "What it deliberately does not do" },
          {
            p: [
              "Nothing here generates shifts for you. That is a deliberate rule: never bulk-create dated shifts without a human deciding. A planner sets ",
              B("Source Allocation"),
              " on a shift by hand, and that one link is the whole engine. The generation wizard is later, in #62; when it ships it must push slots through this exact link.",
            ],
          },
        ],
      },
    ],
  },

  {
    id: "map",
    title: "Model map",
    icon: "git-branch",
    hash: "sha256:sec-map-1",
    blocks: [
      {
        b: "diagram",
        intro: [
          "An object-diagram view (UML-ish, not strict). ",
          B("Click a box"),
          " to jump to its detail card. ",
          B("Hover a box"),
          " to light up only its relationships.",
        ],
        hint: [
          "↳ The thick green arrow ",
          B("slot → allocation"),
          " is the engine of this PR. Everything else reads off it.",
        ],
        nodes: [
          {
            id: "n-crm",
            model: "crm.lead",
            nlabel: "Opportunity",
            change: "ctx",
            ref: "m-alloc",
            col: 1,
            row: 1,
            compartments: [{ label: "context", rows: [[M("type"), " = opportunity"]] }],
          },
          {
            id: "n-project",
            model: "project.project",
            change: "mod",
            badge: "mod",
            ref: "m-project",
            col: 3,
            row: 1,
            compartments: [
              { label: "+ field", rows: [[M("planning_pool_item_count")]] },
              { label: "+ method", rows: [[M("action_open_planning_pool_items()")]] },
            ],
          },
          {
            id: "n-alloc",
            model: "planning.allocation",
            change: "mod",
            badge: "hub",
            ref: "m-alloc",
            col: 2,
            row: 2,
            compartments: [
              {
                label: "+ derived fields",
                rows: [[M("planned_* · remaining_*")], [M("planning_slot_ids"), " O2m"]],
              },
              { label: "+ method", rows: [[M("_planning_placed_hours_by_id()")]] },
            ],
          },
          {
            id: "n-pool",
            model: "planning.pool.item",
            change: "new",
            badge: "new",
            ref: "m-pool",
            col: 3,
            row: 2,
            compartments: [
              {
                label: "SQL view · _auto = False",
                rows: [
                  [M("allocation_id"), " · total"],
                  [M("placed"), " · remaining"],
                ],
              },
              { label: "init() → CREATE VIEW", rows: [] },
            ],
          },
          {
            id: "n-slot",
            model: "planning.slot",
            change: "mod",
            badge: "mod",
            ref: "m-slot",
            col: 2,
            row: 3,
            compartments: [
              { label: "+ field (the link)", rows: [[M("allocation_id"), " M2o → allocation"]] },
              { label: "+ constraint", rows: [[M("_check_source_allocation_is_confirmed")]] },
            ],
          },
        ],
        edges: [
          { from: "n-crm", to: "n-alloc", kind: "ctx", label: "opportunity_id · M2o" },
          { from: "n-alloc", to: "n-pool", kind: "derived", label: "SQL view" },
          { from: "n-slot", to: "n-alloc", kind: "new", label: "allocation_id", thick: true },
          { from: "n-project", to: "n-pool", kind: "new", label: "smart button" },
        ],
      },
    ],
  },

  {
    id: "m-pool",
    title: "planning.pool.item",
    icon: "file-added",
    badge: { label: "new model", tone: "new" },
    file: "addons/acme_planning/models/planning_pool_item.py",
    hash: "sha256:sec-pool-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "A read-only ",
              B("SQL view"),
              " model (",
              C("_auto = False"),
              "). Grain: ",
              B("one row per source allocation"),
              ", so prestation, task and allocation identity survive into planning.",
            ],
          },
        ],
      },
      {
        b: "attrs",
        items: ['_name = "planning.pool.item"', "_auto = False", '_rec_name = "name"'],
      },
      { b: "md", nodes: [{ h: "Fields" }] },
      {
        b: "fields",
        rows: [
          {
            name: "name",
            kind: "Char · compute",
            badges: ["computed"],
            note: ["Human label: ", I("project – service – role – month – person"), "."],
          },
          {
            name: "allocation_id",
            kind: "Many2one",
            badges: ["readonly"],
            tags: ["comodel: planning.allocation", "readonly=True"],
            note: ["→ ", C("planning.allocation"), ". The source row this lens reflects."],
          },
          {
            name: "total / total_hours",
            kind: "Float · compute",
            note: [B("Charge to schedule"), " = allocation quantity (and in hours)."],
          },
          {
            name: "placed / placed_hours",
            kind: "Float · compute",
            note: [
              B("Already planned"),
              " = Σ ",
              C("allocated_hours"),
              " of non-cancelled linked slots.",
            ],
          },
          {
            name: "remaining / remaining_hours",
            kind: "Float · compute",
            note: [B("Reste à planifier"), " = ", C("max(total − placed, 0)"), "."],
          },
          {
            name: "company_id",
            kind: "Many2one",
            note: ["→ ", C("res.company"), "; drives the record rules."],
          },
        ],
      },
      { b: "md", nodes: [{ h: "Methods" }] },
      {
        b: "method",
        sig: "init()",
        decorator: "def init(self):",
        body: [
          "Drops any existing view, then ",
          C("CREATE OR REPLACE VIEW"),
          " selecting allocations ",
          C("WHERE status = 'converted' AND active IS TRUE"),
          ". The allocation ",
          C("id"),
          " becomes the pool item ",
          C("id"),
          ".",
        ],
      },
      {
        b: "method",
        sig: "_compute_quantities()",
        decorator: '@api.depends("allocation_id.quantity", "…planning_slot_ids.allocated_hours")',
        chips: ["depends"],
        body: [
          "Calls the allocation's shared aggregator ",
          C("_planning_placed_hours_by_id()"),
          ", then fills total / placed / remaining in both unit and hours, flooring remaining at zero.",
        ],
      },
      poolModelBlock,
      {
        b: "callout",
        body: [
          B("Why a SQL view and not a stored model?"),
          " A copied pool table would create a second charge store that #60 and #62 would have to reconcile. A view cannot drift: it ",
          I("is"),
          " the allocations.",
        ],
      },
    ],
  },

  {
    id: "m-alloc",
    title: "planning.allocation",
    icon: "file-diff",
    badge: { label: "modified", tone: "mod" },
    file: "addons/acme_planning/models/planning_allocation.py",
    hash: "sha256:sec-alloc-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "The hub. It gains the same total/placed/remaining readings as the pool item, the inverse link to its slots, and the shared aggregator both models use.",
            ],
          },
          { h: "New fields" },
        ],
      },
      {
        b: "fields",
        rows: [
          {
            name: "planned_quantity / planned_hours",
            kind: "Float · compute",
            note: ["Already planned = Σ non-cancelled linked slot hours."],
          },
          {
            name: "remaining_quantity / remaining_hours",
            kind: "Float · compute",
            note: [C("max(total − placed, 0)"), "."],
          },
          {
            name: "planning_slot_ids",
            kind: "One2many",
            badges: ["readonly"],
            tags: ["comodel: planning.slot", "inverse: allocation_id"],
            note: [
              "→ ",
              C("planning.slot"),
              ", inverse of ",
              C("allocation_id"),
              ". The depends-trigger for live recompute.",
            ],
          },
        ],
      },
      { b: "md", nodes: [{ h: "New methods" }] },
      {
        b: "method",
        sig: "_planning_placed_hours_by_id()",
        body: [
          B("Shared aggregator"),
          ", reused by the pool item. One ",
          C("_read_group"),
          " over ",
          C("planning.slot"),
          " (",
          C(".sudo()"),
          ") summing ",
          C("allocated_hours"),
          " where state ≠ cancelled, keyed by allocation id.",
        ],
      },
      {
        b: "code",
        file: "addons/acme_planning/models/planning_allocation.py",
        from: 24,
        to: 23 + ALLOC_AGGREGATOR_LINES.length,
        lang: "python",
        view: "change",
        lines: ALLOC_AGGREGATOR_LINES,
        changed: range(24, 23 + ALLOC_AGGREGATOR_LINES.length),
        expect: { value: "_planning_placed_hours_by_id", status: "ok" },
      },
      {
        b: "callout",
        tone: "warn",
        body: [
          B(["Note the ", C(".sudo()"), " in the aggregator."]),
          " It sums all linked slots regardless of the reader's slot visibility, so “remaining” is consistent for every role.",
        ],
      },
    ],
  },

  {
    id: "m-slot",
    title: "planning.slot",
    icon: "file-diff",
    badge: { label: "modified", tone: "mod" },
    file: "addons/acme_planning/models/planning_slot.py",
    hash: "sha256:sec-slot-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "The consumer. A single new Many2one lets a shift draw from a pool item, plus a guard that keeps the link pointed only at real confirmed charge.",
            ],
          },
          { h: "New field — the link" },
        ],
      },
      {
        b: "fields",
        rows: [
          {
            name: "allocation_id",
            kind: "Many2one",
            note: ["→ ", C("planning.allocation"), ", “Source Allocation”."],
            tags: [
              "domain: status=converted, active=True",
              "index=True",
              "tracking=True",
              "check_company=True",
              'ondelete="set null"',
            ],
          },
        ],
      },
      {
        b: "method",
        sig: "_check_source_allocation_is_confirmed()",
        decorator: '@api.constrains("allocation_id")',
        chips: ["constrains"],
        body: [
          "Belt-and-braces beyond the field ",
          C("domain"),
          ": raises ",
          C("ValidationError"),
          " if a linked allocation is not ",
          C("converted"),
          " & ",
          C("active"),
          ". The domain filters the dropdown; the constraint defends against non-UI writes.",
        ],
      },
      {
        b: "code",
        file: "addons/acme_planning/models/planning_slot.py",
        from: 5,
        to: 4 + SLOT_LINK_LINES.length,
        lang: "python",
        view: "change",
        lines: SLOT_LINK_LINES,
        changed: range(9, 4 + SLOT_LINK_LINES.length),
        mark: range(13, 14),
        expect: { value: "class PlanningSlot", status: "ok" },
      },
      {
        b: "callout",
        body: [
          B([C('ondelete="set null"'), " on purpose."]),
          " Deleting a confirmed allocation should not cascade-delete operational shifts. The shift survives, just unlinked — and the pool's “placed” drops on the next read.",
        ],
      },
    ],
  },

  {
    id: "m-project",
    title: "project.project",
    icon: "file-diff",
    badge: { label: "modified", tone: "mod" },
    file: "addons/acme_planning/models/project_project.py",
    hash: "sha256:sec-project-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "The entry point. A smart button on the confirmed project opens its slice of the pool, grouped by month.",
            ],
          },
        ],
      },
      {
        b: "fields",
        rows: [
          {
            name: "planning_pool_item_count",
            kind: "Integer · compute",
            note: ["Count of this project's pool items, for the smart-button badge."],
            tags: ['groups="acme_planning.group_planning_employee"'],
          },
        ],
      },
      {
        b: "method",
        sig: "action_open_planning_pool_items()",
        body: [
          "Returns the ",
          C("action_planning_pool_item"),
          " window action, narrowed to this project and defaulting to ",
          I("group by month"),
          ".",
        ],
      },
      /* The expect tripwire fired here: soft `open` still renders the block. */
      {
        b: "code",
        file: "addons/acme_planning/models/project_project.py",
        from: 19,
        to: 18 + PROJECT_ACTION_LINES.length,
        lang: "python",
        view: "plain",
        lines: PROJECT_ACTION_LINES,
        changed: range(19, 18 + PROJECT_ACTION_LINES.length),
        expect: { value: "def _compute_planning_pool_item_count", status: "mismatch" },
      },
    ],
  },

  {
    id: "views",
    title: "Views & their intent",
    icon: "table",
    relatedFiles: ["m-project", "m-slot"],
    hash: "sha256:sec-views-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "One new view file (the pool item's list/form/search/action) plus surgical inherits that surface the new readings where planners already work.",
            ],
          },
        ],
      },
      {
        b: "cards",
        cols: 2,
        items: [
          {
            icon: "file-added",
            title: "planning_pool_item_views.xml",
            body: [
              [
                "The pool's own surface — deliberately ",
                B("read-only"),
                ": a list with ",
                C('create/edit/delete="False"'),
                ", a read-only form, a group-by search, and the window action.",
              ],
            ],
          },
          {
            icon: "question",
            title: "Why read-only everywhere?",
            body: [
              [
                "A SQL-view model cannot be written anyway, but stamping ",
                C('create/edit/delete="False"'),
                " makes the intent explicit and stops Odoo rendering dead “New” buttons.",
              ],
            ],
          },
        ],
      },
      {
        b: "code",
        file: "addons/acme_planning/views/planning_pool_item_views.xml",
        from: 3,
        to: 2 + POOL_ACTION_XML_LINES.length,
        lang: "xml",
        view: "change",
        lines: POOL_ACTION_XML_LINES,
        changed: range(3, 2 + POOL_ACTION_XML_LINES.length),
        expect: { value: "action_planning_pool_item", status: "ok" },
      },
      { b: "md", nodes: [{ h: "Inherited views (surfacing the readings)" }] },
      {
        b: "table",
        head: [["File"], ["Change"], ["Intent"]],
        firstColMono: true,
        rows: [
          [
            ["project_project_views.xml"],
            ["Smart button in ", C("button_box")],
            ["“Remaining to Schedule” statinfo button; hidden when count = 0."],
          ],
          [
            ["planning_slot_views.xml"],
            [C("allocation_id"), " in list + form"],
            ["Exposes Source Allocation in the shift dialog (", C("no_create"), ")."],
          ],
        ],
      },
      {
        b: "files",
        paths: [
          "addons/acme_planning/views/planning_slot_views.xml",
          "addons/acme_planning/views/project_project_views.xml",
        ],
      },
    ],
  },

  {
    id: "wizards",
    title: "Wizards",
    icon: "gear",
    hash: "sha256:sec-wizards-1",
    blocks: [
      {
        b: "md",
        nodes: [{ p: ["No new wizards in this PR. Deliberate, and worth recording."] }],
      },
      {
        b: "callout",
        body: [
          "Pool items are consumed ",
          B("manually"),
          ": a planner sets ",
          C("Source Allocation"),
          " in the shift dialog. ADR 0008 defers automatic slot generation to a future wizard (#62), which must create draft slots ",
          B(["through the same ", C("allocation_id"), " link"]),
          " rather than inventing a second consumption path.",
        ],
      },
    ],
  },

  {
    id: "security",
    title: "Security linked to the model",
    icon: "shield-lock",
    hash: "sha256:sec-security-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "Two layers, both read-only: model-level ACLs and row-level company record rules. A derived lens should never be writable.",
            ],
          },
          { h: "Access rights — ir.model.access.csv" },
        ],
      },
      {
        b: "matrix",
        head: ["ACL · group", "read", "write", "create", "unlink"],
        rows: [
          {
            label: "planning.pool.item · group_planning_employee",
            cells: [true, false, false, false],
          },
          {
            label: "planning.pool.item · group_planning_planner",
            cells: [true, false, false, false],
          },
          {
            label: "planning.pool.item · group_planning_manager",
            cells: [true, false, false, false],
          },
        ],
      },
      {
        b: "md",
        nodes: [
          { h: "Record rules — planning_rules.xml" },
          {
            p: [
              "One company rule per group, all read-only, same domain — visible when the item's company is among the user's allowed companies (or company-less):",
            ],
          },
        ],
      },
      {
        b: "code",
        file: "addons/acme_planning/security/planning_rules.xml",
        from: 3,
        to: 2 + RULES_XML_LINES.length,
        lang: "xml",
        view: "change",
        lines: RULES_XML_LINES,
        changed: range(3, 2 + RULES_XML_LINES.length),
        expect: { value: "planning_pool_item_rule_employee_company", status: "ok" },
      },
      {
        b: "callout",
        tone: "key",
        body: [
          B("Multi-company integrity, three ways:"),
          " ",
          C("check_company=True"),
          " on the slot link + ",
          C("_check_company_auto"),
          " on the slot + these ",
          C("company_id in company_ids + [False]"),
          " rules.",
        ],
      },
    ],
  },

  {
    id: "tests",
    title: "Tests — what they prove",
    icon: "beaker",
    file: "addons/acme_planning/tests/test_planning_pool_item.py",
    hash: "sha256:sec-tests-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "One card per test with the scenario and the key assertions. Open the diff only if a card raises a question.",
            ],
          },
        ],
      },
      {
        b: "tests",
        items: [
          {
            name: "test_pool_grain",
            kind: "unit",
            ref: "tests/test_planning_pool_item.py",
            scenario: [
              "Creates allocations in every state (draft, converted, cancelled) plus one archived. Reads the pool view.",
            ],
            asserts: [
              ["Only ", B("active + Converted"), " allocations produce a pool item."],
              ["One row per allocation — never per person×month."],
            ],
          },
          {
            name: "test_live_consumption",
            kind: "unit",
            scenario: [
              "Links slots to a 40 h allocation, then walks the full lifecycle: ",
              B("create → resize → reassign → cancel → unlink"),
              ".",
            ],
            asserts: [
              [
                "Each step moves ",
                C("placed_hours"),
                " / ",
                C("remaining_hours"),
                " immediately — nothing is stored or decremented.",
              ],
              ["A cancelled slot stops counting; unlink restores the remaining charge."],
            ],
          },
          {
            name: "test_overconsumption_floor",
            kind: "unit",
            scenario: ["Plans 48 h of slots against a 40 h allocation."],
            asserts: [[C("remaining_hours"), " floors at ", B("0.0"), " — never negative."]],
          },
          {
            name: "test_allocation_link_constraint",
            kind: "unit",
            scenario: [
              "Tries to point ",
              C("planning.slot.allocation_id"),
              " at a forecast allocation, then at an archived one, via ",
              C("write()"),
              " (not the UI).",
            ],
            asserts: [
              [
                "Both writes raise ",
                C("ValidationError"),
                " — the picker domain is defended by ",
                C("@api.constrains"),
                ".",
              ],
            ],
          },
        ],
      },
    ],
  },

  {
    id: "i18n",
    title: "Translations",
    icon: "globe",
    hash: "sha256:sec-i18n-1",
    blocks: [
      {
        b: "md",
        nodes: [
          {
            p: [
              "The translation diff collapses to one fact: every new label shipped with its French translation in the same PR. Nothing here needs line-by-line review.",
            ],
          },
        ],
      },
      {
        b: "i18n",
        rows: [
          {
            path: "i18n/fr.po",
            status: "M",
            lang: "fr",
            additions: 101,
            deletions: 0,
            entries: { new: 31, updated: 2 },
          },
          {
            path: "i18n/acme_planning.pot",
            status: "M",
            additions: 100,
            deletions: 0,
            entries: { new: 31 },
            note: "regenerated from source — in sync",
          },
        ],
        note: [
          "31 new entries = the pool item fields, view labels and the two smart buttons. The 2 updated French strings fix wording on existing allocation labels.",
        ],
      },
    ],
  },

  {
    id: "patterns",
    title: "Patterns worth stealing",
    icon: "light-bulb",
    hash: "sha256:sec-patterns-1",
    blocks: [
      {
        b: "patterns",
        items: [
          {
            icon: "database",
            term: "SQL-view model",
            ref: "planning_pool_item.py",
            body: [
              C("_auto = False"),
              " + ",
              C("init()"),
              " with ",
              C("CREATE OR REPLACE VIEW"),
              ": a model that is a query, not a table.",
            ],
          },
          {
            icon: "rows",
            term: "Derived readings",
            ref: "@api.depends",
            body: [
              "Non-stored ",
              C("compute"),
              " fields with precise depends on ",
              C("...slot_ids.allocated_hours"),
              " → live, never desynced.",
            ],
          },
          {
            icon: "columns",
            term: "Grouped aggregation",
            ref: "allocated_hours:sum",
            body: [
              "One ",
              C("_read_group"),
              " over slots, keyed by allocation, shared by both models via a single helper.",
            ],
          },
          {
            icon: "shield-lock",
            term: "check_company trio",
            ref: "multi-company",
            body: [
              C("check_company=True"),
              " + ",
              C("_check_company_auto"),
              " + ",
              C("company_id in company_ids + [False]"),
              " rules.",
            ],
          },
          {
            icon: "eye",
            term: "Smart button",
            ref: "project_project.py",
            body: [
              "Computed count field + a ",
              C("statinfo"),
              " button + a window action injecting a domain and a group-by context.",
            ],
          },
          {
            icon: "law",
            term: "Domain + constraint",
            ref: "defense-in-depth",
            body: [
              "Field ",
              C("domain"),
              " filters the picker; ",
              C("@api.constrains"),
              " defends the same rule against non-UI writes.",
            ],
          },
        ],
      },
      {
        b: "code",
        file: "addons/acme_planning/views/project_project_views.xml",
        from: 6,
        to: 5 + SMART_BUTTON_XML_LINES.length,
        lang: "xml",
        view: "diff",
        lines: SMART_BUTTON_XML_LINES,
        changed: range(6, 5 + SMART_BUTTON_XML_LINES.length),
        expect: { value: "oe_stat_button", status: "ok" },
      },
    ],
  },

  {
    id: "files",
    title: "Files changed",
    icon: "file-diff",
    hash: "sha256:sec-files-1",
    blocks: [{ b: "files", paths: files.map((file) => file.path) }],
  },
];

export const pr96: Payload = {
  walkthrough: 1,
  title: "Add live planning pool items",
  commit: "9f3c2ad41b6e7c05",
  headDistance: 0,
  lang: "en",
  meta: { module: "acme_planning", adr: "0008", issue: "59" },
  preset: "odoo",
  pr: {
    number: 96,
    url: "https://github.com/acme-co/planning-suite/pull/96",
    author: "octocat",
    state: "open",
    base: "dev",
    head: "feature/59-shared-pool-remaining-to-schedule",
    commits: 3,
    stats: { files: files.length, additions, deletions },
  },
  files,
  nav,
  sections,
  errors: [
    {
      code: "range-unresolvable",
      message:
        "Lines 210-260 are past the end of the file at the pinned commit (188 lines). The block was dropped.",
      reference: "addons/acme_planning/models/planning_allocation.py:210-260",
      sectionId: "m-alloc",
      line: 142,
    },
  ],
  sourcePath: "walkthroughs/pr-96-shared-pool.md",
  storageKey: "balade:acme-co/planning-suite#96:walkthroughs/pr-96-shared-pool.md",
};
