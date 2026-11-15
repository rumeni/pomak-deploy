import type { CapacitorConfig } from '@capacitor/cli'

// Za razvoj (APK koji priča sa backend-om na računaru preko http) pokreni sa CAP_DEV=1.
// Produkcijski API je na https, pa mešani sadržaj tada nije dozvoljen.
const dev = process.env.CAP_DEV === '1'

const config: CapacitorConfig = {
  appId: 'rs.pomak.app',
  appName: 'POMAK',
  webDir: 'dist',
  android: {
    allowMixedContent: dev,
  },
  server: {
    cleartext: dev,
  },
}

export default config
