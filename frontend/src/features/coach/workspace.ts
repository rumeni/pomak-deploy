/**
 * Coach workspace helpers without React: which space a route belongs to, the invite link and
 * its QR code, a pending invite across login, client search and readiness reasons.
 */

/** The coach space lives under /trener; everything else is the personal space. */
export function isCoachSpacePath(pathname: string): boolean {
  return pathname === '/trener' || pathname.startsWith('/trener/')
}

const LAST_SPACE = 'pomak.coachSpace.'

/** Remembers which space a coach used last, so the app reopens there (per account). */
export function rememberSpace(ownerId: string, space: 'coach' | 'personal'): void {
  try { localStorage.setItem(LAST_SPACE + ownerId, space) } catch { /* private mode: not remembered */ }
}

export function lastSpace(ownerId: string): 'coach' | 'personal' {
  try {
    return localStorage.getItem(LAST_SPACE + ownerId) === 'personal' ? 'personal' : 'coach'
  } catch {
    return 'coach'
  }
}

export const INVITE_CODE = /^[0-9A-F]{16}$/

export function normalizeInviteCode(raw: string): string | null {
  const code = raw.trim().toUpperCase()
  return INVITE_CODE.test(code) ? code : null
}

/** The link a coach sends (WhatsApp, QR in the gym). It opens the web app's connect screen. */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/povezi/${code}`
}

const PENDING_INVITE = 'pomak.pendingInvite'

/** A code from an invite link opened before logging in; used once after login. */
export function savePendingInvite(code: string): void {
  try { sessionStorage.setItem(PENDING_INVITE, code) } catch { /* the code can still be typed */ }
}

export function takePendingInvite(): string | null {
  try {
    const code = sessionStorage.getItem(PENDING_INVITE)
    sessionStorage.removeItem(PENDING_INVITE)
    return code ? normalizeInviteCode(code) : null
  } catch {
    return null
  }
}

/** Case- and diacritics-insensitive (č/ć/š/ž/đ), so "djordje" finds "Đorđe". */
export function foldSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export function matchesSearch(name: string, query: string): boolean {
  const q = foldSearch(query)
  return !q || foldSearch(name).includes(q)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]
  return letters.toUpperCase()
}

export type ReadinessAnswers = Partial<Record<'sleep_hours' | 'motivation' | 'stress' | 'soreness_upper' | 'soreness_lower' | 'hydration', number>>

/**
 * The answers that pulled a readiness score down, worst first. Facts the client gave
 * ("5 h of sleep"), not conclusions; the score itself never changes any load.
 */
export function readinessReasons(answers: ReadinessAnswers): { field: keyof ReadinessAnswers; value: number }[] {
  const weight: { field: keyof ReadinessAnswers; bad: (v: number) => number }[] = [
    { field: 'sleep_hours', bad: (v) => (v <= 6 ? 7 - v : 0) },
    { field: 'stress', bad: (v) => (v >= 4 ? v - 3 : 0) },
    { field: 'soreness_upper', bad: (v) => (v >= 4 ? v - 3 : 0) },
    { field: 'soreness_lower', bad: (v) => (v >= 4 ? v - 3 : 0) },
    { field: 'motivation', bad: (v) => (v <= 2 ? 3 - v : 0) },
    { field: 'hydration', bad: (v) => (v <= 2 ? 3 - v : 0) },
  ]
  return weight
    .map(({ field, bad }) => ({ field, value: answers[field], badness: answers[field] == null ? 0 : bad(answers[field]!) }))
    .filter((r) => r.badness > 0)
    .sort((a, b) => b.badness - a.badness)
    .map(({ field, value }) => ({ field, value: value! }))
}

/** QR modules (true = dark) for a text, with the quiet zone left to the drawing. */
export async function qrModules(text: string): Promise<boolean[][]> {
  const zxing = await import('@zxing/library')
  const matrix = zxing.QRCodeEncoder.encode(text, zxing.QRCodeDecoderErrorCorrectionLevel.M).getMatrix()
  const size = matrix.getWidth()
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => matrix.get(x, y) === 1))
}

/** One SVG path for all dark modules (one unit per module), small enough for a data attribute. */
export function qrPath(modules: boolean[][], margin = 2): string {
  const parts: string[] = []
  modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`)
  }))
  return parts.join('')
}
