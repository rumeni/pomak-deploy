import { Capacitor } from '@capacitor/core'
import { Haptics } from '@capacitor/haptics'
import { LocalNotifications } from '@capacitor/local-notifications'

const REST_NOTIFICATION_ID = 7001
const CHANNEL_ID = 'rest-timer'
let channelReady = false

/**
 * Šta uraditi sa obaveštenjem kad se kraj pauze promeni.
 * - nova ili pomerena pauza: zakaži za novo vreme (staro se zamenjuje, isti ID)
 * - pauza prekinuta pre kraja (Preskoči): otkaži
 * - pauza istekla sama: ne diraj, obaveštenje mora da ostane vidljivo
 */
export function restNotificationAction(
  previousEnd: string | null,
  nextEnd: string | null | undefined,
  now: Date,
): { cancel: boolean; schedule: string | null } {
  const nextInFuture = !!nextEnd && new Date(nextEnd) > now
  if (nextInFuture) return { cancel: false, schedule: nextEnd === previousEnd ? null : nextEnd }
  const cutShort = !!previousEnd && new Date(previousEnd) > now
  return { cancel: cutShort, schedule: null }
}

// Sve operacije idu jedna za drugom: kod brzih "−15 s" paralelni pozivi bi mogli da
// završe obrnutim redom i ostave staro vreme.
let queue: Promise<void> = Promise.resolve()
function enqueue(op: () => Promise<void>): Promise<void> {
  queue = queue.then(op).catch(() => undefined)
  return queue
}

/**
 * Zakazuje Android obaveštenje za kraj pauze, da stigne i kad je ekran zaključan ili je
 * aplikacija u pozadini. U pregledaču ne radi ništa (tajmer na ekranu i dalje radi).
 */
export function scheduleRestEnd(endsAt: Date, title: string, body: string, channelName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  return enqueue(async () => {
    let { display } = await LocalNotifications.checkPermissions()
    if (display === 'prompt' || display === 'prompt-with-rationale') display = (await LocalNotifications.requestPermissions()).display
    if (display !== 'granted') return

    if (!channelReady) {
      await LocalNotifications.createChannel({ id: CHANNEL_ID, name: channelName, importance: 5, vibration: true, visibility: 1 })
      channelReady = true
    }
    // Bez dozvole za tačne alarme plugin bi pri svakom zakazivanju otvarao Android
    // podešavanja, usred treninga. Zato tačan alarm tražimo samo ako je dozvola već data;
    // inače je obaveštenje približno (tajmer na ekranu je uvek tačan).
    const exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm === 'granted'
    await LocalNotifications.schedule({
      notifications: [
        {
          id: REST_NOTIFICATION_ID,
          title,
          body,
          channelId: CHANNEL_ID,
          schedule: { at: endsAt, allowWhileIdle: true },
          isExactNotification: exact,
        },
      ],
    })
  })
}

export function cancelRestEnd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve()
  return enqueue(() => LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] }))
}

/** Kratka vibracija kad pauza istekne dok je aplikacija otvorena. */
export async function restEndedFeedback(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Haptics.vibrate({ duration: 400 }).catch(() => undefined)
  } else {
    navigator.vibrate?.(400)
  }
}
