import { useTranslation } from 'react-i18next'

import { deviceZoneDiffers, SCHEDULE_TZ } from './time'

/** Shown only when this device is in another zone: all schedule times are Belgrade times. */
export function ZoneNote() {
  const { t } = useTranslation()
  if (!deviceZoneDiffers()) return null
  return <p role="note" className="text-xs text-muted">{t('schedule.zoneNote', { zone: SCHEDULE_TZ })}</p>
}
