/**
 * Vocabulary shared by the analyzer's split modules: the analysis error, the
 * package identity a module specifier denotes, the syntax nodes that can
 * reference another module, and the empty documentation model.
 * @module @deepseek-ai/dsh-typert-generator/types
 */

import ts from 'typescript'
import type { DocumentationModel } from './model.ts'

/** Analysis failure with a source-oriented diagnostic. */
export class TypertAnalysisError extends Error {
  override name = 'TypertAnalysisError'
}

/** A package specifier split into the package's name and the subpath inside it. */
export interface ModuleIdentity {
  readonly package: string
  readonly subpath: string
}

/** The syntax nodes whose text can name a type another module exports. */
export type ReferenceSite = ts.TypeReferenceNode | ts.ExpressionWithTypeArguments | ts.ImportTypeNode

/** Documentation model for a declaration that carries no JSDoc block. */
export const EMPTY_DOCUMENTATION: DocumentationModel = { tags: [] }
