/**
 * Helpers to build MCP logical URLs for tools, resources and prompts.
 */

export type LogicalKind = 'tool' | 'resource' | 'prompt'

/**
 * Build a logical URL for a tool call including serialized args as query string.
 */
export function buildLogicalToolUrl(serverName: string, toolName: string, args: unknown): string {
  let query = ''
  try {
    const params = new URLSearchParams()
    const obj = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
    for (const [k, v] of Object.entries(obj)) {
      params.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    const s = params.toString()
    query = s ? `?${s}` : ''
  } catch {
    // ignore serialization issues; fall back to no query
  }
  return `mcp://${serverName}/tools/${toolName}${query}`
}

/**
 * Build a logical URL for a resource fetch including variables as query string.
 */
export function buildLogicalResourceUrl(
  serverName: string,
  resourceName: string,
  variables: Record<string, string | string[]>,
): string {
  let query = ''
  try {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(variables || {})) {
      params.set(k, Array.isArray(v) ? v[0] : String(v))
    }
    const s = params.toString()
    query = s ? `?${s}` : ''
  } catch {
    // ignore
  }
  return `mcp://${serverName}/resources/${resourceName}${query}`
}

/**
 * Build a logical URL based on request kind.
 */
export function buildLogicalUrl(options: {
  kind: LogicalKind
  serverName: string
  name: string
  argsOrVars: unknown
}): string {
  const { kind, serverName, name, argsOrVars } = options
  if (kind === 'resource')
    return buildLogicalResourceUrl(serverName, name, (argsOrVars as any) || {})
  // tools and prompts use tool URL shape
  return buildLogicalToolUrl(serverName, name, argsOrVars)
}
