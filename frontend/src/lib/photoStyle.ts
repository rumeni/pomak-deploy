import type { CSSProperties } from 'react'

/** Photo as a background via the --photo CSS variable; cropping and darkening are done in CSS. */
export const photoStyle = (src: string) => ({ '--photo': `url(${src})` }) as CSSProperties
