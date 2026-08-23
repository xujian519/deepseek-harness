/**
 * MCP surface: mount `@deepseek-ai/dsh-mcp-client` against the OpenViking
 * Streamable HTTP endpoint so the model gets the server's full tool set
 * (`mcp__openviking__*`) and new tools appear on server upgrade without a
 * release.
 *
 * Mounted last and deliberately not awaited: the client's first tools/list
 * blocks activation, and a server that accepts the connection but never
 * answers must not hold up the registrations above it.
 * @module @deepseek-ai/dsh-openviking/mcp-surface
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import {
  apply as mcpClientApply,
  Config as mcpClientConfigSchema,
  inject as mcpClientInject,
  name as mcpClientName,
} from '@deepseek-ai/dsh-mcp-client'

/** Mount the OpenViking MCP server as a streamable-http client.
 * @param ctx - Cordis context scoped to this registration.
 * @param options - the resolved client configuration to carry into the MCP session.
 * @returns the mounted client fiber.
 */
export function mountOpenVikingMcp(ctx: Context, options: {
  endpoint: string
  apiKey: string
  account: string
  user: string
  agentId: string
  timeoutMs: number
}): Fiber {
  const headers: Record<string, string> = {}
  if (options.apiKey) headers['x-api-key'] = options.apiKey
  if (options.account) headers['x-openviking-account'] = options.account
  if (options.user) headers['x-openviking-user'] = options.user
  if (options.agentId) headers['x-openviking-agent'] = options.agentId

  return ctx.plugin({
    name: mcpClientName,
    // Preserve the client's declared injections: an inline object without
    // them loses the proxy rights its apply() relies on (systemPrompt, tools).
    inject: mcpClientInject,
    Config: mcpClientConfigSchema,
    apply: mcpClientApply,
  }, {
    transport: 'streamable-http',
    serverName: 'openviking',
    url: `${options.endpoint.replace(/\/$/, '')}/mcp`,
    headers,
    toolCallTimeoutMs: options.timeoutMs,
    failOnStartupError: false,
    surfaceInstructions: true,
  } as never)
}
