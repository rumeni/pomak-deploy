import type { CSSProperties } from 'react'

/** Fotografija kao pozadina (CSS promenljiva --photo); sliku iseca i zatamnjuje CSS. */
export const photoStyle = (src: string) => ({ '--photo': `url(${src})` }) as CSSProperties
