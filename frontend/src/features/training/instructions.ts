const TIP = /^(Savet|Tip):\s*/

/** Koraci uputstva (red po red) i savet (poslednji red koji počinje sa "Savet:" / "Tip:"). */
export function splitInstructions(text: string): { steps: string[]; tip: string | null } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const last = lines.at(-1)
  if (last && TIP.test(last)) return { steps: lines.slice(0, -1), tip: last }
  return { steps: lines, tip: null }
}
