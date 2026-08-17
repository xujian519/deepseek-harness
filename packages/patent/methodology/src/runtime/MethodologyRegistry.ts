/**
 * MethodologyRegistry: registration and keyword-based matching of methodology
 * components.
 *
 * Ported from Sati's src/methodology/runtime/MethodologyRegistry.ts (registration
 * plus match logic only; no orchestration/planning).
 * @module @deepseek-ai/dsh-methodology/runtime/MethodologyRegistry
 */

import type {
  MethodologyComponent,
  MethodologyContext,
  MethodologyDomain,
  MethodologyMatch,
} from '../types.ts'
import { fiveWhys } from './components/five-whys.ts'
import { mece } from './components/mece.ts'
import { swot } from './components/swot.ts'
import { pdca } from './components/pdca.ts'
import { fishbone } from './components/fishbone.ts'
import { firstPrinciples } from './components/first-principles.ts'
import { sixHats } from './components/six-hats.ts'
import { triz } from './components/triz.ts'

/** Default component set covering the core analytical/classical scenarios. */
export const DEFAULT_METHODOLOGY_COMPONENTS: MethodologyComponent[] = [
  fiveWhys,
  mece,
  swot,
  pdca,
  fishbone,
  firstPrinciples,
  sixHats,
  triz,
]

/** A registry of named reasoning-methodology components. */
export class MethodologyRegistry {
  private readonly components = new Map<string, MethodologyComponent>()

  constructor(components: MethodologyComponent[] = DEFAULT_METHODOLOGY_COMPONENTS) {
    for (const component of components) this.register(component)
  }

  /** Register one component; a duplicate name throws. */
  register(component: MethodologyComponent): void {
    if (this.components.has(component.name)) {
      throw new Error('Methodology "' + component.name + '" is already registered')
    }
    this.components.set(component.name, component)
  }

  /**
   * Match components against a context, scored by identify() and filtered by
   * applicable domain. Returns the top-K matches above minScore, highest first.
   * @param context - the task context to match against.
   * @param options - topK, minScore, and optional domain filter.
   * @returns the ranked matches.
   */
  match(
    context: MethodologyContext,
    options: { topK?: number; minScore?: number; domain?: MethodologyDomain } = {},
  ): MethodologyMatch[] {
    const topK = options.topK ?? 1
    const minScore = options.minScore ?? 0
    const domain = options.domain
    const scored: MethodologyMatch[] = []
    for (const component of this.components.values()) {
      if (domain !== undefined && !component.applicableDomains.includes(domain)) continue
      const score = component.identify(context)
      if (score > minScore) scored.push({ component, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  /** Whether a component with the given name is registered. */
  has(name: string): boolean {
    return this.components.has(name)
  }

  /** All registered components in registration order. */
  list(): MethodologyComponent[] {
    return [...this.components.values()]
  }
}

/**
 * Extract lowercased keyword tokens from a goal string (word/segment based).
 * @param goal - the goal text to tokenize.
 * @returns unique lowercased tokens.
 */
export function extractMethodologyKeywords(goal: string): string[] {
  const words = goal.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
  return [...new Set(words)]
}
