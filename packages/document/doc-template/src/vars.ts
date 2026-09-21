/**
 * Variable schema and validated resolution, rewritten from `domains/doctmpl/vars.go`
 * of the Go project Mady.
 *
 * `validatedResolve` keeps the upstream pipeline exactly: validate, apply
 * defaults, substitute, then report what is left. The warnings and the residual
 * placeholder list are the deterministic evidence a document gate reads, so
 * neither is dropped when the other is present.
 * @module @deepseek-ai/dsh-doc-template/vars
 */

import {
  assertNever,
  type DocTemplate,
  type ResolveResult,
  type VarDefinition,
  type VarIssue,
} from './types.ts'

/** Placeholder pattern: a variable name of word characters between double braces. */
const PLACEHOLDER_PATTERN = /\{\{\w+\}\}/gu

/**
 * The constraints of one template's variables, indexed for lookup.
 * A duplicate name keeps the last definition, as the upstream schema did.
 */
export class VarSchema {
  /** The definitions, in declaration order. */
  readonly definitions: readonly VarDefinition[]
  private readonly positionByName: ReadonlyMap<string, number>

  /**
   * @param definitions - the variable definitions, in declaration order.
   */
  constructor(definitions: readonly VarDefinition[]) {
    this.definitions = definitions
    const positions = new Map<string, number>()
    definitions.forEach((definition, position) => positions.set(definition.name, position))
    this.positionByName = positions
  }

  /**
   * Every declared variable name, in declaration order.
   * @returns the names.
   */
  names(): readonly string[] {
    return this.definitions.map(definition => definition.name)
  }

  /**
   * The names of the variables that must be supplied.
   * @returns the required names, in declaration order.
   */
  requiredNames(): readonly string[] {
    return this.definitions.filter(definition => definition.required).map(definition => definition.name)
  }

  /**
   * Find one variable definition.
   * @param name - the variable name.
   * @returns the definition, or `undefined` when the schema declares no such variable.
   */
  get(name: string): VarDefinition | undefined {
    const position = this.positionByName.get(name)
    return position === undefined ? undefined : this.definitions[position]
  }

  /**
   * Check the supplied variables against the schema. A missing required variable
   * is reported before its type, because an absent value has no type.
   * @param vars - the supplied variables.
   * @returns one issue per problem, in declaration order; empty means valid.
   */
  validate(vars: Readonly<Record<string, string>>): readonly VarIssue[] {
    const issues: VarIssue[] = []
    for (const definition of this.definitions) {
      const value = vars[definition.name]
      if (definition.required && (value === undefined || value.trim() === '')) {
        issues.push({ variable: definition.name, code: 'missing_required', message: '必填变量未提供' })
        continue
      }
      if (value === undefined || value === '') continue
      const issue = typeIssue(definition, value)
      if (issue !== undefined) issues.push(issue)
    }
    return issues
  }

  /**
   * Copy the supplied variables and fill in the declared defaults. An empty
   * default is no default, as upstream.
   * @param vars - the supplied variables.
   * @returns a new variable map; the input is not modified.
   */
  applyDefaults(vars: Readonly<Record<string, string>>): Record<string, string> {
    const resolved: Record<string, string> = { ...vars }
    for (const definition of this.definitions) {
      const declaredDefault = definition.default
      if (resolved[definition.name] === undefined && declaredDefault !== undefined && declaredDefault !== '') {
        resolved[definition.name] = declaredDefault
      }
    }
    return resolved
  }
}

/**
 * Build the schema of a template's variables.
 * @param definitions - the variable definitions, in declaration order.
 * @returns the schema.
 */
export function createVarSchema(definitions: readonly VarDefinition[]): VarSchema {
  return new VarSchema(definitions)
}

/**
 * Check one supplied value against its declared type.
 * @param definition - the variable definition.
 * @param value - the non-empty supplied value.
 * @returns the issue, or `undefined` when the value matches the declared type.
 */
function typeIssue(definition: VarDefinition, value: string): VarIssue | undefined {
  switch (definition.type) {
    case 'number':
      return Number.isFinite(Number(value.trim()))
        ? undefined
        : { variable: definition.name, code: 'invalid_type', message: `期望 number 类型，实际值: ${JSON.stringify(value)}` }
    case 'bool': {
      const normalized = value.trim().toLowerCase()
      return normalized === 'true' || normalized === 'false'
        ? undefined
        : { variable: definition.name, code: 'invalid_type', message: `期望 bool 类型 (true/false)，实际值: ${JSON.stringify(value)}` }
    }
    case 'string':
    case 'multiline':
      return undefined
    /* v8 ignore next 2 -- VAR_TYPES is closed and every variant is handled above. */
    default:
      return assertNever(definition.type)
  }
}

/**
 * Every distinct `{{variable}}` name in a text, in first-occurrence order.
 * @param body - the text to scan.
 * @returns the placeholder names, without their braces.
 */
export function extractPlaceholders(body: string): readonly string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of body.match(PLACEHOLDER_PATTERN) ?? []) {
    const name = match.slice(2, -2)
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Substitute the supplied variables into a body. A placeholder with no supplied
 * value is left in place, so it is reported as residual rather than erased.
 * @param body - the body to substitute into.
 * @param vars - the variables to substitute.
 * @returns the body with every supplied placeholder replaced.
 */
export function substitutePlaceholders(body: string, vars: Readonly<Record<string, string>>): string {
  return body.replace(PLACEHOLDER_PATTERN, (placeholder: string) => vars[placeholder.slice(2, -2)] ?? placeholder)
}

/**
 * Resolve a template's variables in one pipeline: validate, apply defaults,
 * substitute, then report the residual placeholders.
 * @param template - the template whose body is resolved.
 * @param vars - the supplied variables.
 * @returns the resolved body, its non-blocking warnings, and its residual placeholders.
 */
export function validatedResolve(template: DocTemplate, vars: Readonly<Record<string, string>>): ResolveResult {
  const warnings = template.varSchema.validate(vars)
  const output = substitutePlaceholders(template.body, template.varSchema.applyDefaults(vars))
  return { output, warnings, residual: extractPlaceholders(output) }
}
