import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { CoachPage } from '../features/coach/CoachPage'
import { CoachClientPage } from '../features/coach/CoachClientPage'
import { LoginPage } from '../features/auth/LoginPage'
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage, EmailVerificationPendingPage } from '../features/auth/AccountEmailPages'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { DeleteAccountPage } from '../features/auth/DeleteAccountPage'
import { ProfilePage } from '../features/auth/ProfilePage'
import { RegisterPage } from '../features/auth/RegisterPage'
import { FoodDetailPage } from '../features/nutrition/FoodDetailPage'
import { NewFoodPage } from '../features/nutrition/NewFoodPage'
import { RecipePage } from '../features/nutrition/RecipePage'
import { TargetPage } from '../features/target/TargetPage'
import { ExerciseProgressPage } from '../features/progress/ExerciseProgressPage'
import { MeasurementsPage } from '../features/progress/MeasurementsPage'
import { GoalFormPage } from '../features/progress/GoalFormPage'
import { TargetSetupPage } from '../features/target/TargetSetupPage'
import { FoodsPage } from '../features/nutrition/FoodsPage'
import { OnboardingPage } from '../features/onboarding/OnboardingPage'
import { ProgressPage } from '../features/progress/ProgressPage'
import { TodayPage } from '../features/today/TodayPage'
import { RoutineEditorPage } from '../features/training/RoutineEditorPage'
import { TrainingPage } from '../features/training/TrainingPage'
import { ActiveWorkoutPage } from '../features/workout/ActiveWorkoutPage'
import { SessionDetailPage } from '../features/workout/SessionDetailPage'
import { Button } from '../components/ui'
import { AddEntryPage } from '../features/diary/AddEntryPage'
import { DiaryPage } from '../features/diary/DiaryPage'
import { EntryPage } from '../features/diary/EntryPage'
import { ManualEntryPage } from '../features/diary/ManualEntryPage'
import { MealSettingsPage } from '../features/diary/MealSettingsPage'
import { useOutboxSync } from '../features/workout/sync'
import { useAuth } from '../lib/auth'
import { AppLayout } from './AppLayout'

export function App() {
  const { me, loading, unreachable, retry } = useAuth()
  const location = useLocation()
  const { t } = useTranslation()
  useOutboxSync(me?.id)

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted">{t('common.loading')}</div>
  }

  if (unreachable) return <UnreachableScreen onRetry={retry} />

  // Recovery links must work even when the browser still has an old session
  // or is paused in onboarding.
  if (location.pathname === '/lozinka/reset') return <ResetPasswordPage />
  if (location.pathname === '/potvrda-emaila') return <VerifyEmailPage />

  if (!me) {
    return (
      <Routes>
        <Route path="/prijava" element={<LoginPage />} />
        <Route path="/registracija" element={<RegisterPage />} />
        <Route path="/lozinka/zaboravljena" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Navigate to="/prijava" replace />} />
      </Routes>
    )
  }

  if (me.email_verification_required && !me.email_verified) {
    return <Routes>
      <Route path="*" element={<EmailVerificationPendingPage />} />
    </Routes>
  }

  if (!me.profile.onboarding_completed_at) {
    return <OnboardingPage />
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/danas" element={<TodayPage />} />
        <Route path="/trening" element={<TrainingPage />} />
        <Route path="/ishrana" element={<DiaryPage />} />
        <Route path="/napredak" element={<ProgressPage />} />
        <Route path="/trener" element={<CoachPage />} />
      </Route>
      <Route path="/trener/klijenti/:id" element={<CoachClientPage />} />
      <Route path="/trening/aktivan" element={<ActiveWorkoutPage />} />
      <Route path="/trening/istorija/:id" element={<SessionDetailPage />} />
      <Route path="/profil" element={<ProfilePage />} />
      <Route path="/profil/lozinka" element={<ChangePasswordPage />} />
      <Route path="/profil/obroci" element={<MealSettingsPage />} />
      <Route path="/profil/obrisi-nalog" element={<DeleteAccountPage />} />
      <Route path="/ishrana/dodaj" element={<AddEntryPage />} />
      <Route path="/ishrana/stavka" element={<EntryPage />} />
      <Route path="/ishrana/rucni" element={<ManualEntryPage />} />
      <Route path="/ishrana/namirnice" element={<FoodsPage />} />
      <Route path="/ishrana/namirnice/nova" element={<NewFoodPage />} />
      <Route path="/ishrana/namirnice/:id" element={<FoodDetailPage />} />
      <Route path="/ishrana/recepti/novi" element={<RecipePage />} />
      <Route path="/ishrana/cilj" element={<TargetPage />} />
      <Route path="/napredak/vezba/:id" element={<ExerciseProgressPage />} />
      <Route path="/napredak/merenja" element={<MeasurementsPage />} />
      <Route path="/napredak/ciljevi/novi" element={<GoalFormPage />} />
      <Route path="/ishrana/cilj/novi" element={<TargetSetupPage />} />
      <Route path="/ishrana/recepti/:id" element={<RecipePage />} />
      <Route path="/trening/rutine/nova" element={<RoutineEditorPage />} />
      <Route path="/trening/rutine/:id" element={<RoutineEditorPage />} />
      <Route path="*" element={<Navigate to="/danas" replace />} />
    </Routes>
  )
}

/** Korisnik je prijavljen, ali server nije dostupan: ne prikazuj ekran za prijavu. */
function UnreachableScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  useEffect(() => {
    // Pokušaj ponovo kad se aplikacija vrati iz pozadine ili kad pregledač javi da ima mreže.
    window.addEventListener('online', onRetry)
    const resume = Capacitor.isNativePlatform() ? CapApp.addListener('resume', onRetry) : null
    return () => {
      window.removeEventListener('online', onRetry)
      void resume?.then((h) => h.remove())
    }
  }, [onRetry])

  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-4xl font-extrabold tracking-tight text-brand">POMAK</p>
      <p className="text-muted">{t('errors.noConnection')}</p>
      <Button onClick={onRetry}>{t('common.retry')}</Button>
    </main>
  )
}
