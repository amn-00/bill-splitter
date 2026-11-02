import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The body is `unknown` until we have checked it, so TypeScript forces the checks.
export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>()
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' })
  }
}

export function requireText(body: unknown, field: string): string {
  const value = isRecord(body) ? body[field] : undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HTTPException(422, { message: `${field} must be a non-empty string` })
  }
  return value.trim()
}

// Money is whole cents. Rejects 0, negatives, decimals, strings, null and
// numbers too big to be exact in JavaScript.
export function requirePositiveCents(body: unknown, field: string): number {
  const value = isRecord(body) ? body[field] : undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HTTPException(422, { message: `${field} must be a positive whole number of cents` })
  }
  return value
}
