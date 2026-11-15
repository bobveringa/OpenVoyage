import {
  BedDouble,
  BedSingle,
  House,
  MapPin,
  MoonStar,
  Tent,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { Stay } from '@/api/client'

export type StayType = Stay['stay_type']

export const STAY_TYPES: readonly { value: StayType; label: string; icon: LucideIcon }[] = [
  { value: 'HOTEL', label: 'Hotel', icon: BedDouble },
  { value: 'RENTAL', label: 'Apartment or rental', icon: House },
  { value: 'HOSTEL', label: 'Hostel', icon: BedSingle },
  { value: 'CAMPING', label: 'Camping', icon: Tent },
  { value: 'FRIENDS', label: 'With friends or family', icon: Users },
  { value: 'OVERNIGHT_TRAVEL', label: 'Overnight travel', icon: MoonStar },
  { value: 'OTHER', label: 'Other', icon: MapPin },
]

export function stayTypeInfo(type: StayType) {
  return STAY_TYPES.find((item) => item.value === type) ?? STAY_TYPES[STAY_TYPES.length - 1]!
}

type IconNode = [string, Record<string, string | number>][]
type IconElement = { props?: { icon?: { node?: IconNode } } }

const iconMarkup = new Map<StayType, string>()

function escapeAttribute(value: string | number) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** The icon's shapes, read from the element a lucide icon returns: no rendering needed. */
function iconNode(icon: LucideIcon): IconNode {
  const render = (icon as unknown as { render?: (props: object, ref: null) => IconElement }).render
  return render?.({}, null)?.props?.icon?.node ?? []
}

/** The stay type's icon as SVG markup, for the map's HTML pins (same icon as in the form). */
export function stayTypeIconHtml(type: StayType): string {
  const cached = iconMarkup.get(type)
  if (cached !== undefined) return cached
  const shapes = iconNode(stayTypeInfo(type).icon).map(([tag, attributes]) => {
    const pairs = Object.entries(attributes)
      .filter(([name]) => name !== 'key')
      .map(([name, value]) => `${name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}="${escapeAttribute(value)}"`)
    return `<${tag} ${pairs.join(' ')}/>`
  }).join('')
  const markup = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
    + `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
  iconMarkup.set(type, markup)
  return markup
}
