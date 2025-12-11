/**
 * Credits context provider for MCP paywall.
 * This class does not "calculate" credits, it builds the context
 * and resolves the configured credit policy.
 */
import { CreditsOption, CreditsContext, AuthResult } from '../types/paywall.types.js'

/**
 * Provide credits using fixed value or a function receiving contextual information.
 */
export class CreditsContextProvider {
  /**
   * Resolve the credits to redeem based on the provided option.
   * @param creditsOption - Credits configuration (fixed bigint or function).
   * @param args - Original handler arguments.
   * @param result - Handler result.
   * @param authResult - Authentication result with request metadata.
   * @returns Credits to redeem as bigint. Defaults to 1n when option is not provided.
   */
  resolve(
    creditsOption: CreditsOption | undefined,
    args: any,
    result: any,
    authResult: AuthResult,
  ): bigint {
    if (typeof creditsOption === 'bigint') {
      return creditsOption
    }

    if (typeof creditsOption === 'function') {
      const ctx: CreditsContext = {
        args,
        result,
        request: {
          authHeader: `Bearer ${authResult.token}`,
          logicalUrl: authResult.logicalUrl,
          toolName: this.extractToolNameFromUrl(authResult.logicalUrl),
        },
      }
      return creditsOption(ctx)
    }

    // Default to 1 credit
    return 1n
  }

  /**
   * Extract tool name from a logical MCP URL.
   * Falls back to 'tool' for HTTP endpoints or invalid URLs.
   * @param logicalUrl - Logical URL string (mcp:// or http://).
   * @returns Tool name derived from the URL path, or 'tool' as fallback.
   */
  private extractToolNameFromUrl(logicalUrl: string): string {
    try {
      const url = new URL(logicalUrl)
      // HTTP(S) endpoints don't contain tool names in the URL path
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return 'tool'
      }
      // For mcp:// URLs, extract from pathname
      const pathParts = url.pathname.split('/').filter((part) => part.length > 0)
      return pathParts[pathParts.length - 1] || 'tool'
    } catch {
      return 'tool'
    }
  }
}
