/**
 * Stable two-stop gradient for one member avatar, derived from the member id
 * so the roster never reshuffles colors between renders. Pure presentation
 * (a CSS value, not locale-owned copy), so it lives in a `.ts` module.
 * @param memberId - the member's child session id.
 * @returns a CSS linear-gradient value.
 */
export function avatarGradient(memberId: string): string {
  let hue = 0
  for (let index = 0; index < memberId.length; index += 1) {
    hue = (hue * 31 + memberId.charCodeAt(index)) % 360
  }
  return `linear-gradient(135deg, hsl(${String(hue)} 72% 52%), hsl(${String((hue + 42) % 360)} 76% 60%))`
}
