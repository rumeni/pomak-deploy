import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { setFormatLocale } from '../lib/format'
import { en } from './en'
import { sr } from './sr'

export type Language = 'sr-Latn' | 'en'
export const LANGUAGES: Language[] = ['sr-Latn', 'en']

const STORAGE_KEY = 'pomak.lang'
// Jezici bivše Jugoslavije razumeju srpski; ostali dobijaju engleski.
const SERBIAN_LIKE = ['sr', 'hr', 'bs', 'sh', 'cnr', 'me']

/** Izabrani jezik iz podešavanja, inače jezik telefona. */
export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'sr-Latn' || saved === 'en') return saved
  } catch {
    // privatni režim ili blokiran storage: koristi jezik telefona
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (SERBIAN_LIKE.includes(base)) return 'sr-Latn'
    if (base === 'en') return 'en'
  }
  return 'en'
}

/** Oznaka jezika koju očekuje backend (profil i Accept-Language). */
export function toServerLanguage(language: Language): 'sr-latn' | 'en' {
  return language === 'en' ? 'en' : 'sr-latn'
}

export function fromServerLanguage(language: string): Language {
  return language === 'en' ? 'en' : 'sr-Latn'
}

function applyLanguage(language: string) {
  setFormatLocale(language === 'en' ? 'en-GB' : 'sr-Latn-RS')
  document.documentElement.lang = language
}

i18n.on('languageChanged', applyLanguage)

void i18n.use(initReactI18next).init({
  resources: { 'sr-Latn': { translation: sr }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: 'sr-Latn',
  interpolation: { escapeValue: false }, // React već štiti od ubacivanja HTML-a
  returnNull: false,
})
applyLanguage(i18n.language)

export async function changeLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // izbor važi do zatvaranja aplikacije
  }
  await i18n.changeLanguage(language)
}

export default i18n
