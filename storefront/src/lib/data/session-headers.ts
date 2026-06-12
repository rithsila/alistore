import "server-only"
import { headers as nextHeaders } from "next/headers"
import { getAuthHeaders } from "./cookies"

/** Medusa's session cookie (express-session) set by the OAuth callbacks. */
export const SESSION_COOKIE_NAME = "connect.sid"

/**
 * Pull a single cookie's *raw* (still URL-encoded) value out of the incoming
 * Cookie header so it can be forwarded to the backend verbatim — re-encoding a
 * value `next/headers` already decoded would corrupt the signed `connect.sid`.
 */
export function extractCookie(
  rawCookieHeader: string,
  name: string
): string | undefined {
  for (const part of rawCookieHeader.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim()
    }
  }
  return undefined
}

/**
 * Build auth headers carrying the starter's JWT (if a token session exists) AND
 * the forwarded `connect.sid` (if a social session exists). Either is enough for
 * the backend to authenticate the customer.
 */
export async function buildSessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }

  let rawCookie = ""
  try {
    rawCookie = (await nextHeaders()).get("cookie") ?? ""
  } catch {
    rawCookie = ""
  }

  const sid = extractCookie(rawCookie, SESSION_COOKIE_NAME)
  if (sid) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=${sid}`
  }

  return headers
}
