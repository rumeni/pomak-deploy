import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

import { listenForNativePushTaps, startPushRecovery } from './push'
import { subscribeTheme } from './theme'

/** Podešavanja koja važe samo u Android aplikaciji; u pregledaču registruje service worker. */
export async function setupNative(): Promise<void> {
  // Push registrations left to remove (an offline sign-out, an app closed mid-request).
  startPushRecovery()

  if (!Capacitor.isNativePlatform()) {
    // U APK-u su fajlovi već na telefonu; service worker bi tamo samo usporio start
    // i mogao da posluži stari kod posle ažuriranja aplikacije.
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
    return
  }

  // Dark mode also needs readable Android status-bar icons. Capacitor names
  // styles by icon colour: Dark = light icons, Light = dark icons.
  const syncStatusBar = () => {
    const dark = document.documentElement.dataset.pomakMode === 'dark'
    void Promise.allSettled([
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }),
      StatusBar.setBackgroundColor({ color: dark ? '#11171c' : '#f2efe9' }),
    ])
  }
  syncStatusBar()
  subscribeTheme(syncStatusBar)

  // A tapped push notification opens its screen (only in builds with Firebase).
  await listenForNativePushTaps().catch(() => undefined)

  // Sistemsko dugme "nazad" vraća na prethodni ekran, a sa početnog izlazi iz aplikacije.
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.exitApp()
  })
}
