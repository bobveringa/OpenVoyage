import { cn } from '@/lib/utils'

// Windows shows flag emoji as two letters, so flags are bundled SVG files
// (flag-icons, MIT). Only the URLs are in the bundle; each image is fetched
// when a flag is first shown.
const flagUrls = import.meta.glob('../../../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const flagsByCode = new Map(
  Object.entries(flagUrls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4).toUpperCase(), url]),
)

/** A country's flag as a small image. Decorative: show the country name next to it. */
export function CountryFlag({ className, countryCode }: { className?: string; countryCode: string }) {
  const url = flagsByCode.get(countryCode.toUpperCase())
  if (!url) return null
  return <img alt="" aria-hidden="true" className={cn('h-3 w-4 shrink-0 rounded-[2px] object-cover', className)} src={url} />
}
