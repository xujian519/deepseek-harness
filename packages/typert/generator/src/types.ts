/**
 * Vocabulary shared by the analyzer's split modules: the analysis error, the
 * package identity a module specifier denotes, the syntax nodes that can
 * reference another module, and the empty documentation model.
 * @module @deepseek-ai/dsh-typert-generator/types
 */

import ts from 'typescript'
import type { DocumentationModel, TypertFace } from './model.ts'

/** Raised inside one analysis pass when a missing annotation was queued as a source edit. */
export class SourceEditQueued extends Error {}

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

/** Missing-annotation handling at public business boundaries. */
export type AnalysisMode = 'check' | 'write'


/** One parsed tsconfig, memoizable per workspace snapshot. */
export interface ParsedConfig {
  /** Absolute config path. */
  readonly path: string
  /** The TypeScript parse result. */
  readonly parsed: ts.ParsedCommandLine
}

/** One package face registration discovered from an aggregate tsconfig. */
export interface PackageRegistration {
  /** The face whose aggregate references this package project. */
  readonly face: TypertFace
  /** The package manifest name. */
  readonly name: string
  /** Real package root directory. */
  readonly root: string
  /** The package's own parsed tsconfig. */
  readonly config: ParsedConfig
  /** The parsed package.json content. */
  readonly manifest: Record<string, unknown>
  /** Export subpaths owned by this face for dual-face packages. */
  readonly exportSubpaths?: readonly string[]
}

/** One queued source edit that writes a missing annotation. */
export interface SourceEdit {
  readonly file: string
  readonly position: number
  readonly text: string
}

/** The package import a type reference reaches after following package-local forwarding modules. */
export interface PackageImport {
  readonly module: ModuleIdentity
  /** Name the type is exported under at that package subpath. */
  readonly name: string
}
