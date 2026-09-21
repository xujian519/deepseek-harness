/**
 * Local connectivity smoke for the Desktop-bound OpenViking integration.
 *
 * Runs from the openviking package so tsconfig paths resolve the workspace
 * sources directly. Verifies against a live local service:
 *   A) the plugin's OpenVikingClient reaches /health (probeHealth path);
 *   B) the MCP bridge URL `${endpoint}/mcp` accepts streamable-http and
 *      returns a tools/list payload with at least one openviking tool;
 *   C) the same client against an unreachable endpoint produces a single
 *      OpenVikingError (the fail-soft warn path in the plugin).
 *
 * Run: pnpm --filter @deepseek-ai/dsh-openviking exec tsx tests/smoke-live.ts [endpoint]
 */

import { OpenVikingClient } from '../src/client.ts'
import { OpenVikingError } from '../src/errors.ts'

const endpoint = process.argv[2] ?? 'http://127.0.0.1:1933'

async function probeHealth(): Promise<void> {
  const client = new OpenVikingClient({
    endpoint,
    apiKey: '',
    account: '',
    user: '',
    agentId: 'dsh-desktop-smoke',
    timeoutMs: 5_000,
  })
  const health = await client.health()
  console.log(`A) /health → status=${health.status} healthy=${String((health as { healthy?: boolean }).healthy)} version=${(health as { version?: string }).version ?? '?'}`)
}

async function probeMcp(): Promise<void> {
  // Streamable-http handshake: POST initialize, then tools/list. The server
  // requires both application/json and text/event-stream in Accept.
  const url = `${endpoint.replace(/\/$/, '')}/mcp`
  const acceptHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  const initBody = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-desktop-smoke', version: '0' } },
  }
  const init = await fetch(url, { method: 'POST', headers: acceptHeaders, body: JSON.stringify(initBody) })
  const sessionId = init.headers.get('mcp-session-id') ?? ''
  const initText = await init.text()
  console.log(`B1) POST ${url} initialize → HTTP ${init.status} session=${sessionId.slice(0, 12) || '(none)'}`)
  if (!init.ok) { console.log(`    body: ${initText.slice(0, 200)}`); return }

  // Send `notifications/initialized` and then tools/list on the same session.
  const postInit = {
    method: async (body: unknown): Promise<Response> => fetch(url, {
      method: 'POST',
      headers: { ...acceptHeaders, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify(body),
    }),
  }
  await postInit.method({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const list = await postInit.method({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const listText = await list.text()
  const parsed = parseFirstJson(listText)
  const tools = (parsed?.result?.tools ?? []) as Array<{ name?: string }>
  console.log(`B2) tools/list → HTTP ${list.status}, tool count=${tools.length}`)
  if (tools.length > 0) console.log(`    first 8: ${tools.slice(0, 8).map(t => t.name ?? '?').join(', ')}`)
  if (!list.ok || tools.length === 0) console.log(`    body: ${listText.slice(0, 300)}`)
}

function parseFirstJson(text: string): { result?: { tools?: unknown } } | undefined {
  // Server may respond with an SSE stream; take the first `data:` payload if so.
  if (text.startsWith('event:') || text.includes('\ndata:')) {
    const line = text.split('\n').find(l => l.startsWith('data:'))
    if (!line) return undefined
    try { return JSON.parse(line.slice(5).trim()) as { result?: { tools?: unknown } } } catch { return undefined }
  }
  try { return JSON.parse(text) as { result?: { tools?: unknown } } } catch { return undefined }
}

async function probeUnreachable(): Promise<void> {
  const client = new OpenVikingClient({
    endpoint: 'http://127.0.0.1:1',
    apiKey: '', account: '', user: '',
    agentId: 'dsh-desktop-smoke-dead',
    timeoutMs: 2_000,
  })
  try {
    await client.health()
    console.log('C) unexpected: dead endpoint returned successfully')
  } catch (error) {
    const label = error instanceof OpenVikingError ? `OpenVikingError(${error.code ?? 'no-code'})` : (error as Error).constructor.name
    console.log(`C) dead endpoint → ${label}: ${(error as Error).message.slice(0, 120)}`)
  }
}

async function main(): Promise<void> {
  console.log(`=== OpenViking Desktop smoke against ${endpoint} ===`)
  await probeHealth().catch((e: unknown) => { console.log(`A) FAILED: ${(e as Error).message}`) })
  await probeMcp().catch((e: unknown) => { console.log(`B) FAILED: ${(e as Error).message}`) })
  await probeUnreachable().catch((e: unknown) => { console.log(`C) FAILED: ${(e as Error).message}`) })
}

main().catch((error: unknown) => { console.error(error); process.exit(1) })
