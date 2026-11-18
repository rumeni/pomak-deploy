import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

import { listenForNativePushTaps } from './push'

/** Podešavanja koja važe samo u Android aplikaciji; u pregledaču registruje service worker. */
export async function setupNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // U APK-u su fajlovi već na telefonu; service worker bi tamo samo usporio start
    // i mogao da posluži stari kod posle ažuriranja aplikacije.
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
    return
  }

  // Neka podešavanja ne postoje na svim verzijama Androida; greška jednog ne sme da blokira ostala.
  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Light }),
    StatusBar.setBackgroundColor({ color: '#f4f7f7' }),
  ])

  // A tapped push notification opens its screen (only in builds with Firebase).
  await listenForNativePushTaps().catch(() => undefined)

  // Sistemsko dugme "nazad" vraća na prethodni ekran, a sa početnog izlazi iz aplikacije.
  await App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.exitApp()
  })
}
