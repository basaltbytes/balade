/**
 * Type-only entry for the resolved-payload contract.
 *
 * Runtime validation lives in `schema.ts`; every exported type below is
 * derived from that single source of truth. The SPA imports this module only
 * through `app/src/contract.ts`.
 */

import type * as Contract from "./schema.js";

export type Inline = typeof Contract.Inline.Type;
export type MdNode = typeof Contract.MdNode.Type;

export type Lang = typeof Contract.Lang.Type;

export type FileStatus = typeof Contract.FileStatus.Type;
export type FileDiff = typeof Contract.FileDiff.Type;
export type FileEntry = typeof Contract.FileEntry.Type;
export type FileGroup = typeof Contract.FileGroup.Type;
export type NavNode = typeof Contract.NavNode.Type;

export type CodeBlock = typeof Contract.CodeBlock.Type;
export type Block = typeof Contract.Block.Type;
export type PresetBlock = typeof Contract.PresetBlock.Type;
export type FieldRow = typeof Contract.FieldRow.Type;
export type TestItem = typeof Contract.TestItem.Type;
export type I18nRow = typeof Contract.I18nRow.Type;
export type CardItem = typeof Contract.CardItem.Type;
export type PatternItem = typeof Contract.PatternItem.Type;
export type DiagramBlock = typeof Contract.DiagramBlock.Type;
export type MermaidBlock = typeof Contract.MermaidBlock.Type;
export type FenceBlock = typeof Contract.FenceBlock.Type;
export type DiagramNode = typeof Contract.DiagramNode.Type;
export type DiagramEdge = typeof Contract.DiagramEdge.Type;

export type Section = typeof Contract.Section.Type;
export type ErrorCard = typeof Contract.ErrorCard.Type;
export type Payload = typeof Contract.Payload.Type;

export type ReviewMark = typeof Contract.ReviewMark.Type;
export type ReviewState = typeof Contract.ReviewState.Type;

export type QaAgentStatus = typeof Contract.QaAgentStatus.Type;
export type QaThreadId = typeof Contract.QaThreadId.Type;
export type QaTurnId = typeof Contract.QaTurnId.Type;
export type QaGeneration = typeof Contract.QaGeneration.Type;
export type QaAnchor = typeof Contract.QaAnchor.Type;
export type QaQuestion = typeof Contract.QaQuestion.Type;
export type QaTurn = typeof Contract.QaTurn.Type;
export type QaThread = typeof Contract.QaThread.Type;
export type QaState = typeof Contract.QaState.Type;
export type QaAskRequest = typeof Contract.QaAskRequest.Type;

export type IndexEntry = typeof Contract.IndexEntry.Type;
export type IndexPayload = typeof Contract.IndexPayload.Type;

export type CheckCode = typeof Contract.CheckCode.Type;
export type CheckDiagnostic = typeof Contract.CheckDiagnostic.Type;
export type RangeEcho = typeof Contract.RangeEcho.Type;
export type CheckReport = typeof Contract.CheckReport.Type;
export type Frontmatter = typeof Contract.Frontmatter.Type;
