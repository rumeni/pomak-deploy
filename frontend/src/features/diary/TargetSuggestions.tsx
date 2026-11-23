import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Card } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDecimal } from '../../lib/format'
import { mealForTime } from './meals'
import type { DayTotals } from './model'
import { useRecentFoods } from './store'
import { focusMacro, remainingToTarget, suggestFoods, suggestionText, type MacroKey } from './toTarget'
import type { DayTarget, MealSetting } from './types'

const MACRO_LABEL: Record<MacroKey, string> = { protein: 'nutrition.protein', carbs: 'nutrition.carbs', fat: 'nutrition.fat' }

/** "Do cilja: 820 kcal" (naming the coach when he set the target) and what is left of each macro. */
export function RemainingLine({ totals, target }: { totals: DayTotals; target: DayTarget }) {
  const { t } = useTranslation()
  const rem = remainingToTarget(totals, target)
  const coach = target.mode === 'coach' && target.set_by_name ? target.set_by_name : null
  const kcalText = rem.kcal >= 0
    ? coach ? t('diary.remainingCoach', { name: coach, kcal: formatDecimal(rem.kcal) }) : t('diary.remaining', { kcal: formatDecimal(rem.kcal) })
    : coach ? t('diary.overTargetCoach', { name: coach, kcal: formatDecimal(-rem.kcal) }) : t('diary.overTarget', { kcal: formatDecimal(-rem.kcal) })
  const left = (['protein', 'carbs', 'fat'] as const)
    .filter((m) => (rem[m] ?? 0) > 0)
    .map((m) => `${t(MACRO_LABEL[m])} ${formatDecimal(rem[m]!)} g`)
  return (
    <>
      <p className="text-sm text-muted tabular-nums">{kcalText}</p>
      {left.length > 0 && <p className="text-sm text-muted tabular-nums">{t('diary.macrosLeft', { list: left.join(' · ') })}</p>}
    </>
  )
}

/** Amounts of the user's own recent foods that fit in what is left today (no ready-made menus). */
export function TargetSuggestions({ date, totals, target, settings }: {
  date: string; totals: DayTotals; target: DayTarget; settings: MealSetting[]
}) {
  const { t } = useTranslation()
  const { me } = useAuth()
  const recent = useRecentFoods(me?.id)
  const rem = remainingToTarget(totals, target)
  const focus = focusMacro(rem, target)
  const ideas = recent ? suggestFoods(recent, rem, focus) : []
  if (!ideas.length) return null
  const meal = mealForTime(settings, new Date())
  return (
    <Card>
      <h2 className="font-semibold">{t('diary.suggestionsTitle')}</h2>
      <p className="text-sm text-muted">{t(`diary.suggestionsFocus_${focus ?? 'none'}`)}</p>
      <ul className="mt-2 flex flex-col">
        {ideas.map((idea) => (
          <li key={idea.food.id}>
            <Link
              to={`/ishrana/stavka?namirnica=${idea.food.id}&datum=${date}&obrok=${meal}`}
              className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-2 active:bg-brand-soft"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{idea.food.name}</span>
                <span className="block text-sm text-muted tabular-nums">{suggestionText(idea, focus, t)}</span>
              </span>
              <span aria-hidden className="text-xl text-accent">+</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-muted">{t('diary.suggestionsNote')}</p>
    </Card>
  )
}
