/**
 * A throwaway git repository for the resolver tests: a small "PR" branch with
 * an added, a modified, a deleted, a purely renamed and a moved-and-edited
 * file, plus gettext catalogues. No gh.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "fixtures");

export interface FixtureRepo {
  dir: string;
  /** SHA the walkthroughs are stamped against. */
  pin: string;
  write(path: string, content: string): void;
  commit(message: string): string;
  commitEmpty(message: string): void;
  /** Writes a fixture walkthrough with `__COMMIT__` replaced, and commits it. */
  addWalkthrough(name: string, fixture: string): string;
  cleanup(): void;
}

/**
 * Recent git spawns a detached `git maintenance run --auto` after commit and
 * fetch; one still writing `.git/objects/pack` while cleanup() runs makes
 * rmSync fail with ENOTEMPTY. Fixture repos keep maintenance foreground-only,
 * and cleanup retries in case a straggler wins the race once anyway.
 */
const NO_BACKGROUND_MAINTENANCE: ReadonlyArray<readonly [string, string]> = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
  ["gc.autoDetach", "false"],
];

function removeRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function run(dir: string, args: string[]): string {
  const config = NO_BACKGROUND_MAINTENANCE.flatMap(([key, value]) => ["-c", `${key}=${value}`]);
  return execFileSync("git", [...config, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
}

const BASE_MODEL = `from odoo import fields, models


class PlanningPoolItem(models.Model):
    _name = "planning.pool.item"
    _description = "Pool item"

    name = fields.Char()
    total = fields.Float()
`;

const PIN_MODEL = `from odoo import api, fields, models


class PlanningPoolItem(models.Model):
    _name = "planning.pool.item"
    _description = "Pool item"
    _auto = False

    name = fields.Char()
    total = fields.Float()
    placed = fields.Float(compute="_compute_placed")

    @api.depends("slot_ids.allocated_hours")
    def _compute_placed(self):
        for item in self:
            item.placed = 0.0
`;

const BASE_PO = `msgid ""
msgstr ""
"Project-Id-Version: acme\\n"

msgid "Pool item"
msgstr "Élément du pool"

msgid "Total"
msgstr "Total"
`;

const PIN_PO = `msgid ""
msgstr ""
"Project-Id-Version: acme\\n"

msgid "Pool item"
msgstr "Élément de pool"

msgid "Total"
msgstr "Total"

msgid "Placed"
msgstr "Placé"
`;

/** Purely renamed on the PR branch: the diff carries no body at all. */
const VIEW = `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="planning_pool_item_view_list" model="ir.ui.view">
        <field name="name">planning.pool.item.list</field>
        <field name="model">planning.pool.item</field>
        <field name="arch" type="xml">
            <list>
                <field name="name"/>
                <field name="total"/>
            </list>
        </field>
    </record>
</odoo>
`;

/** Moved and edited on the PR branch: a rename git still detects by similarity. */
const BASE_HELPER = `"""Helpers shared by the planning pool views."""


def split_hours(total, slots):
    """Spread a charge over the given slots."""
    if not slots:
        return []
    share = total / len(slots)
    return [share for _ in slots]


def label_for(item):
    """Human label of a pool row."""
    return "%s (%s)" % (item.name, item.total)


def is_live(slot):
    return slot.state != "cancel"
`;

const PIN_HELPER = `"""Helpers shared by the planning pool views."""


def split_hours(total, slots):
    """Spread a charge over the given slots, ignoring cancelled ones."""
    live = [slot for slot in slots if is_live(slot)]
    if not live:
        return []
    share = total / len(live)
    return [share for _ in live]


def label_for(item):
    """Human label of a pool row."""
    return "%s (%s)" % (item.name, item.total)


def is_live(slot):
    return slot.state != "cancel"
`;

const POT = `msgid "Pool item"
msgstr ""

msgid "Total"
msgstr ""

msgid "Placed"
msgstr ""
`;

export function createFixtureRepo(): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), "balade-fixture-"));

  const write = (path: string, content: string): void => {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  };
  const remove = (path: string): void => {
    rmSync(join(dir, path), { force: true });
  };
  const move = (from: string, to: string): void => {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    run(dir, ["mv", from, to]);
  };
  const commit = (message: string): string => {
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "--no-gpg-sign", "-m", message]);
    return run(dir, ["rev-parse", "HEAD"]).trim();
  };

  run(dir, ["init", "-b", "main"]);
  write("models/planning_pool_item.py", BASE_MODEL);
  write(
    "models/planning_slot.py",
    'from odoo import models\n\n\nclass PlanningSlot(models.Model):\n    _inherit = "planning.slot"\n',
  );
  write("i18n/fr.po", BASE_PO);
  write("docs/old.md", "# Superseded design note\n");
  write("views/pool_views.xml", VIEW);
  write("models/planning_helper.py", BASE_HELPER);
  commit("base");
  /* The PR branch: the diff base is the merge-base with `main`. */
  run(dir, ["checkout", "-b", "feature/pool"]);

  write("models/planning_pool_item.py", PIN_MODEL);
  write(
    "models/planning_allocation.py",
    'from odoo import fields, models\n\n\nclass PlanningAllocation(models.Model):\n    _inherit = "planning.allocation"\n\n    slot_ids = fields.One2many("planning.slot", "allocation_id")\n',
  );
  write("i18n/fr.po", PIN_PO);
  write("i18n/acme.pot", POT);
  write(
    "security/ir.model.access.csv",
    "id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink\naccess_pool,pool,model_planning_pool_item,base.group_user,1,0,0,0\n",
  );
  remove("docs/old.md");
  move("views/pool_views.xml", "views/planning_pool_views.xml");
  move("models/planning_helper.py", "utils/planning_helper.py");
  write("utils/planning_helper.py", PIN_HELPER);
  const pin = commit("feat: live planning pool items");

  const addWalkthrough = (name: string, fixture: string): string => {
    const template = readFileSync(join(FIXTURES, fixture), "utf8");
    const path = `walkthroughs/${name}`;
    write(path, template.replaceAll("__COMMIT__", pin));
    commit(`docs: walkthrough ${name}`);
    return path;
  };

  return {
    dir,
    pin,
    write,
    commit,
    commitEmpty: (message) => {
      run(dir, ["commit", "--allow-empty", "--no-gpg-sign", "-m", message]);
    },
    addWalkthrough,
    cleanup: () => removeRepo(dir),
  };
}

export interface FixtureClone {
  dir: string;
  cleanup(): void;
}

/** Advertises a commit as `pull/<n>/head`, the ref GitHub publishes for every PR. */
export function advertisePull(origin: FixtureRepo, pull: number, commit: string): void {
  run(origin.dir, ["update-ref", `refs/pull/${pull}/head`, commit]);
}

/**
 * The reviewer holding a PR URL: a clone of the fixture repository sitting on
 * `main`, the PR branch never checked out. The fixture plays origin and
 * advertises its current HEAD as `pull/<n>/head`.
 */
export function cloneOnMain(origin: FixtureRepo, pull: number): FixtureClone {
  advertisePull(origin, pull, "HEAD");
  const dir = mkdtempSync(join(tmpdir(), "balade-clone-"));
  const configFlags = NO_BACKGROUND_MAINTENANCE.flatMap(([key, value]) => [
    "--config",
    `${key}=${value}`,
  ]);
  run(dir, ["clone", "--quiet", "--branch", "main", ...configFlags, origin.dir, "."]);
  return {
    dir,
    cleanup: () => removeRepo(dir),
  };
}
