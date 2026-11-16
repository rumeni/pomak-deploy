import { useTranslation } from 'react-i18next'
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white active:bg-brand-dark disabled:opacity-50',
  secondary: 'bg-brand-soft text-brand-dark active:bg-line disabled:opacity-50',
  ghost: 'text-brand-dark active:bg-brand-soft',
  danger: 'bg-danger text-white active:opacity-90 disabled:opacity-50',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' }) {
  const sizing = size === 'sm' ? 'min-h-10 px-4 text-sm' : 'min-h-12 px-5 text-base'
  return (
    <button
      className={`${sizing} app-button ${variant === 'primary' ? 'app-button-primary' : ''} ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Field({ label, error, id, ...props }, ref) {
  const inputId = id ?? props.name
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={!!error}
        className="app-input min-h-12 w-full rounded-2xl border border-line bg-card px-4 text-base outline-none focus:border-brand aria-[invalid=true]:border-danger"
        {...props}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
})

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`app-card ${className}`}>
      {title && <h2 className="mb-3 text-lg font-bold tracking-tight text-ink">{title}</h2>}
      {children}
    </section>
  )
}

/** Zaglavlje glavnog ekrana (taba): naslov i, desno, izbor jezika ili druga akcija. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="page-header flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 pt-1">{action}</div>}
    </header>
  )
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Card className="text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </Card>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </p>
  )
}

export function ChoiceCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string
  legend: string
  options: { value: T; title: string; text?: string }[]
  value: T | ''
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer gap-3 rounded-2xl border-2 bg-card p-4 ${
            value === o.value ? 'border-brand' : 'border-line'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-1 size-5 shrink-0 accent-brand"
          />
          <span>
            <span className="block font-semibold">{o.title}</span>
            {o.text && <span className="block text-sm text-muted">{o.text}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/** Mali izbor u jednom redu (npr. pol, iskustvo). */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: { value: T; label: string }[]
  value: T | ''
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`min-h-12 flex-1 rounded-xl border-2 px-3 text-base font-medium ${
              value === o.value ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line bg-card'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Zaglavlje ekrana preko celog prikaza (bez donje navigacije): nazad, naslov, akcija. */
export function ScreenHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-xl items-center gap-2 pl-2 pr-3">
        <button type="button" onClick={onBack} aria-label={t('common.back')} className="flex size-11 items-center justify-center rounded-full active:bg-line">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
        {action}
      </div>
    </header>
  )
}

export const selectClass =
  'app-input min-h-12 w-full rounded-2xl border border-line bg-card px-4 text-base outline-none focus:border-brand'

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = props.id ?? props.name
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} className={selectClass} {...props}>
        {children}
      </select>
    </div>
  )
}

/** Učitavanje preko celog ekrana; ne ulazi ispod statusne trake telefona. */
export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="pt-safe">
      <p className="p-6 text-center text-muted">{t('common.loading')}</p>
    </div>
  )
}
