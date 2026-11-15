import { splitInstructions } from './instructions'

/** Uputstvo kao numerisani koraci; poslednji red "Savet:" / "Tip:" je izdvojen. */
export function ExerciseInstructions({ text }: { text: string }) {
  const { steps, tip } = splitInstructions(text)
  if (!steps.length && !tip) return null
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {tip && <p className="rounded-xl bg-brand-soft p-3 text-brand-dark">{tip}</p>}
    </div>
  )
}
