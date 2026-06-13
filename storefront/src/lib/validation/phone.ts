/**
 * Cambodia phone validation — the single regex from security.md / PRD, used at
 * every entry point: `^(\+855|0)[1-9]\d{7,8}$`.
 */
export const CAMBODIA_PHONE_REGEX = /^(\+855|0)[1-9]\d{7,8}$/

export function isValidCambodiaPhone(value: string): boolean {
  return CAMBODIA_PHONE_REGEX.test(value.trim())
}
