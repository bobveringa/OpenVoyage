import type { ImmichAlbumLink } from '@/api/client'
import type { SelectOption } from '@/components/ui/select'

export function createImmichAlbumOptions(
  links: ImmichAlbumLink[],
): SelectOption[] {
  return links.map((link) => {
    const ownerName = getImmichAlbumOwnerName(link)

    return {
      description: `Connected by ${ownerName}`,
      label: link.name ?? 'Unavailable album',
      selectedDescription: ownerName,
      value: link.id,
    }
  })
}

export function getImmichAlbumOwnerName(link: ImmichAlbumLink): string {
  const fullName = [link.connected_by.first_name, link.connected_by.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  return fullName || link.connected_by.username || 'Trip contributor'
}
