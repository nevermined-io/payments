/**
 * Raw-body capture for MPP body binding.
 *
 * The MPP challenge can be bound to a `sha-256=<base64>` digest of the request
 * body. Express has already parsed the body by the time the middleware runs,
 * and re-serializing `req.body` does not reproduce the bytes the buyer sent —
 * key order, whitespace and number formatting all differ. So the raw buffer has
 * to be kept at parse time.
 */

import { createHash } from 'crypto'
import type { Request, Response } from 'express'

const RAW_BODY = Symbol.for('nevermined.rawBody')

/**
 * `verify` hook for the body parser.
 *
 * @example
 * ```typescript
 * app.use(express.json({ verify: captureRawBody }))
 * ```
 */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (buf?.length) {
    const withRawBody = req as Request & { [RAW_BODY]?: Buffer }
    withRawBody[RAW_BODY] = Buffer.from(buf)
  }
}

/** Returns the buffer captured by {@link captureRawBody}, if any. */
export function getRawBody(req: Request): Buffer | undefined {
  return (req as Request & { [RAW_BODY]?: Buffer })[RAW_BODY]
}

/** Computes the RFC 9530 `sha-256=<base64>` digest MPP challenges use. */
export function computeBodyDigest(raw: Buffer): string {
  return `sha-256=${createHash('sha256').update(raw).digest('base64')}`
}
