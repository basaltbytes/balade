/* Every user-visible chrome string lives here, in both shipped languages.
   Components read them through `useStrings()`; none of them hardcode English. */

export type { Lang } from "./contract";
import type { Lang } from "./contract";

export interface Strings {
  loading: string;
  loadFailed: string;
  payloadUnreadable: string;
  payloadFetchFailed: string;
  payloadLocationInvalid: string;
  retry: string;

  /* header */
  prState: Record<"open" | "closed" | "merged", string>;
  wantsToMerge: (commits: number, base: string, head: string) => string;
  filesChanged: (n: number) => string;
  pinnedAt: string;
  headMovedTitle: (n: number) => string;
  headMovedBody: string;
  errorsTitle: (n: number) => string;
  errorAt: (reference: string) => string;
  readOnlyArtifact: string;

  /* review state */
  progress: (done: number, total: number) => string;
  filesViewed: (done: number, total: number) => string;
  markReviewed: string;
  reviewed: string;
  nextUnreviewed: string;
  hideReviewed: string;
  showReviewed: string;
  reviewComplete: string;
  reviewCompleteBody: string;
  resetTitle: string;
  resetBody: string;
  resetSections: string;
  resetFiles: string;
  dismiss: string;
  saveFallback: string;
  saveFailed: string;

  /* clarification Q&A */
  qa: {
    askAgent: string;
    title: string;
    close: string;
    selectedPassage: string;
    questionLabel: string;
    questionPlaceholder: string;
    submit: string;
    submitting: string;
    pending: string;
    failed: string;
    unavailable: string;
    followUp: string;
    followUpPlaceholder: string;
    exchanges: (n: number) => string;
    status: Record<"pending" | "answered" | "failed", string>;
  };

  /* code */
  view: Record<"plain" | "change" | "diff", string>;
  collapse: string;
  expand: string;
  lineRange: (from: number, to: number) => string;
  openDiffOnGitHub: string;
  expectMismatch: string;
  expectMismatchBody: (quote: string) => string;
  highlightSkippedLongLine: string;

  /* files */
  files: {
    header: (files: number, additions: number, deletions: number) => string;
    viewed: string;
    split: string;
    unified: string;
    binary: string;
    missing: (path: string) => string;
    renamedFrom: (path: string) => string;
    status: Record<"A" | "M" | "D" | "R", string>;
  };

  /* widget chrome */
  fieldsHead: [string, string, string];
  i18nHead: [string, string, string, string];
  entries: Record<"new" | "updated" | "removed", string>;
  calloutTitle: Record<"key" | "warn", string>;
  unknownBlock: (kind: string) => string;
  diagramRelations: string;
  mermaidUnavailable: string;

  /* index route */
  index: {
    title: string;
    subtitle: (repo: string) => string;
    empty: string;
    updated: (date: string) => string;
    neverOpened: string;
    stale: (n: number) => string;
    upToDate: string;
  };

  /* dev-only affordance, kept in the dictionary so no literal escapes */
  devToggleStale: string;
}

const en: Strings = {
  loading: "Loading the walkthrough…",
  loadFailed: "The walkthrough could not be loaded.",
  payloadUnreadable: "The walkthrough data does not match the format this app reads.",
  payloadFetchFailed: "The walkthrough could not be fetched from the CLI.",
  payloadLocationInvalid: "The walkthrough link contains an invalid path.",
  retry: "Try again",

  prState: { open: "Open", closed: "Closed", merged: "Merged" },
  wantsToMerge: (commits, base, head) =>
    `wants to merge ${commits} ${commits === 1 ? "commit" : "commits"} into ${base} from ${head}`,
  filesChanged: (n) => `${n} ${n === 1 ? "file" : "files"} changed`,
  pinnedAt: "pinned at",
  headMovedTitle: (n) => `head moved by ${n} ${n === 1 ? "commit" : "commits"}`,
  headMovedBody:
    "The walkthrough was written against the pinned commit. Later commits are not described here.",
  errorsTitle: (n) => `${n} ${n === 1 ? "reference" : "references"} could not be resolved`,
  errorAt: (reference) => `at ${reference}`,
  readOnlyArtifact: "Read-only artifact.",

  progress: (done, total) => `${done}/${total} sections reviewed`,
  filesViewed: (done, total) => `${done}/${total} files viewed`,
  markReviewed: "Mark reviewed",
  reviewed: "Reviewed",
  nextUnreviewed: "Next unreviewed",
  hideReviewed: "Hide reviewed",
  showReviewed: "Show reviewed",
  reviewComplete: "Review complete",
  reviewCompleteBody: "Every section is marked reviewed.",
  resetTitle: "Some marks were reset",
  resetBody: "The content changed since you marked it, so these went back to unreviewed:",
  resetSections: "Sections",
  resetFiles: "Files",
  dismiss: "Dismiss",
  saveFallback: "The CLI did not take your marks — this browser keeps them.",
  saveFailed: "Your marks could not be saved.",

  qa: {
    askAgent: "Ask agent",
    title: "Clarifications",
    close: "Close clarifications",
    selectedPassage: "Selected passage",
    questionLabel: "Your question",
    questionPlaceholder: "What would you like clarified?",
    submit: "Ask",
    submitting: "Asking…",
    pending: "The agent is working on this question…",
    failed: "The agent could not answer this question. You can ask another follow-up.",
    unavailable: "Clarifications are temporarily unavailable.",
    followUp: "Ask a follow-up",
    followUpPlaceholder: "What else should the agent clarify?",
    exchanges: (n) => `${n} ${n === 1 ? "exchange" : "exchanges"}`,
    status: { pending: "Working", answered: "Answered", failed: "Failed" },
  },

  view: { plain: "plain", change: "change", diff: "diff" },
  collapse: "Collapse",
  expand: "Expand",
  lineRange: (from, to) => `lines ${from}–${to}`,
  openDiffOnGitHub: "View this file's diff on GitHub",
  expectMismatch: "expect mismatch",
  expectMismatchBody: (quote) =>
    `The first line of this range does not contain ${quote}. The lines below may be the wrong ones.`,
  highlightSkippedLongLine: "Line too long to highlight; shown as plain text.",

  files: {
    header: (files, additions, deletions) =>
      `${files} ${files === 1 ? "file" : "files"} changed · +${additions} −${deletions}`,
    viewed: "Viewed",
    split: "Split",
    unified: "Unified",
    binary: "Binary file — no diff to show.",
    missing: (path) => `${path} is not among the changed files of this pull request.`,
    renamedFrom: (path) => `renamed from ${path}`,
    status: { A: "added", M: "modified", D: "deleted", R: "renamed" },
  },

  fieldsHead: ["Field", "Kind", "Note"],
  i18nHead: ["File", "Language", "Lines", "Entries"],
  entries: { new: "new", updated: "updated", removed: "removed" },
  calloutTitle: { key: "Key point", warn: "Warning" },
  unknownBlock: (kind) => `No renderer for “${kind}” blocks.`,
  diagramRelations: "Relations",
  mermaidUnavailable: "This diagram could not be drawn; its source is shown instead.",

  index: {
    title: "Walkthroughs",
    subtitle: (repo) => `Walkthroughs found in ${repo}.`,
    empty: "No walkthrough files were found in this repository.",
    updated: (date) => `updated ${date}`,
    neverOpened: "not started",
    stale: (n) => `head moved by ${n} ${n === 1 ? "commit" : "commits"}`,
    upToDate: "up to date",
  },

  devToggleStale: "dev: toggle stale banner",
};

const fr: Strings = {
  loading: "Chargement de la balade…",
  loadFailed: "La balade n’a pas pu être chargée.",
  payloadUnreadable:
    "Les données de la balade ne correspondent pas au format attendu par l’application.",
  payloadFetchFailed: "La balade n’a pas pu être récupérée auprès du CLI.",
  payloadLocationInvalid: "Le lien de la balade contient un chemin invalide.",
  retry: "Réessayer",

  prState: { open: "Ouverte", closed: "Fermée", merged: "Fusionnée" },
  wantsToMerge: (commits, base, head) =>
    `veut fusionner ${commits} commit${commits === 1 ? "" : "s"} dans ${base} depuis ${head}`,
  filesChanged: (n) => `${n} fichier${n === 1 ? "" : "s"} modifié${n === 1 ? "" : "s"}`,
  pinnedAt: "épinglé sur",
  headMovedTitle: (n) => `la tête a avancé de ${n} commit${n === 1 ? "" : "s"}`,
  headMovedBody: "La balade décrit le commit épinglé. Les commits suivants n’y figurent pas.",
  errorsTitle: (n) => `${n} référence${n === 1 ? "" : "s"} non résolue${n === 1 ? "" : "s"}`,
  errorAt: (reference) => `à ${reference}`,
  readOnlyArtifact: "Document en lecture seule.",

  progress: (done, total) => `${done}/${total} sections relues`,
  filesViewed: (done, total) => `${done}/${total} fichiers vus`,
  markReviewed: "Marquer comme relu",
  reviewed: "Relu",
  nextUnreviewed: "Section suivante à relire",
  hideReviewed: "Masquer le relu",
  showReviewed: "Afficher le relu",
  reviewComplete: "Relecture terminée",
  reviewCompleteBody: "Toutes les sections sont marquées comme relues.",
  resetTitle: "Des marques ont été remises à zéro",
  resetBody: "Le contenu a changé depuis votre marque ; ces éléments repassent à relire :",
  resetSections: "Sections",
  resetFiles: "Fichiers",
  dismiss: "Fermer",
  saveFallback: "La CLI n’a pas pris vos marques — ce navigateur les conserve.",
  saveFailed: "Vos marques n’ont pas pu être enregistrées.",

  qa: {
    askAgent: "Interroger l’agent",
    title: "Éclaircissements",
    close: "Fermer les éclaircissements",
    selectedPassage: "Passage sélectionné",
    questionLabel: "Votre question",
    questionPlaceholder: "Que souhaitez-vous faire préciser ?",
    submit: "Demander",
    submitting: "Envoi…",
    pending: "L’agent travaille sur cette question…",
    failed: "L’agent n’a pas pu répondre. Vous pouvez poser une autre question.",
    unavailable: "Les éclaircissements sont temporairement indisponibles.",
    followUp: "Poser une question complémentaire",
    followUpPlaceholder: "Que doit encore préciser l’agent ?",
    exchanges: (n) => `${n} échange${n === 1 ? "" : "s"}`,
    status: { pending: "En cours", answered: "Répondu", failed: "Échec" },
  },

  view: { plain: "brut", change: "changements", diff: "diff" },
  collapse: "Replier",
  expand: "Déplier",
  lineRange: (from, to) => `lignes ${from}–${to}`,
  openDiffOnGitHub: "Voir le diff de ce fichier sur GitHub",
  expectMismatch: "expect incorrect",
  expectMismatchBody: (quote) =>
    `La première ligne de la plage ne contient pas ${quote}. Les lignes ci-dessous sont peut-être les mauvaises.`,
  highlightSkippedLongLine:
    "Ligne trop longue pour la coloration syntaxique ; affichée en texte brut.",

  files: {
    header: (files, additions, deletions) =>
      `${files} fichier${files === 1 ? "" : "s"} modifié${files === 1 ? "" : "s"} · +${additions} −${deletions}`,
    viewed: "Vu",
    split: "Côte à côte",
    unified: "Unifié",
    binary: "Fichier binaire — aucun diff à afficher.",
    missing: (path) => `${path} ne fait pas partie des fichiers modifiés de cette pull request.`,
    renamedFrom: (path) => `renommé depuis ${path}`,
    status: { A: "ajouté", M: "modifié", D: "supprimé", R: "renommé" },
  },

  fieldsHead: ["Champ", "Type", "Note"],
  i18nHead: ["Fichier", "Langue", "Lignes", "Entrées"],
  entries: { new: "nouvelles", updated: "mises à jour", removed: "supprimées" },
  calloutTitle: { key: "Point clé", warn: "Attention" },
  unknownBlock: (kind) => `Aucun rendu pour les blocs « ${kind} ».`,
  diagramRelations: "Relations",
  mermaidUnavailable: "Ce diagramme n’a pas pu être tracé ; sa source est affichée à la place.",

  index: {
    title: "Balades",
    subtitle: (repo) => `Balades trouvées dans ${repo}.`,
    empty: "Aucun fichier de balade trouvé dans ce dépôt.",
    updated: (date) => `mis à jour ${date}`,
    neverOpened: "non commencée",
    stale: (n) => `la tête a avancé de ${n} commit${n === 1 ? "" : "s"}`,
    upToDate: "à jour",
  },

  devToggleStale: "dev : bannière « obsolète »",
};

export const dictionaries = { en, fr } satisfies Record<Lang, Strings>;

export const stringsFor = (lang: Lang): Strings => dictionaries[lang];
