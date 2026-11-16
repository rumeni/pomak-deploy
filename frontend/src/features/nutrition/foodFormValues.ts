import { formatDecimal } from '../../lib/format'

/** API decimal strings stay canonical; input boxes use the selected locale. */
export function foodFormValue(value: string | null | undefined): string {
  return value == null ? '' : formatDecimal(Number(value))
}
