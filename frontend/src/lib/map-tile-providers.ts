import type { TileLayerOptions } from 'leaflet'

export const MAP_TILE_PROVIDER_SETTING_KEY = 'map.tile_provider'

export const DEFAULT_MAP_TILE_PROVIDER_URL =
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

const DEFAULT_MAP_TILE_LAYER_OPTIONS: TileLayerOptions = {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}

const CUSTOM_MAP_TILE_LAYER_OPTIONS: TileLayerOptions = {
  maxZoom: 19,
}

export function resolveMapTileProvider(value: unknown): MapTileProvider {
  const url = typeof value === 'string' ? value.trim() : ''
  const resolvedUrl = url.length > 0 ? url : DEFAULT_MAP_TILE_PROVIDER_URL

  return {
    options:
      resolvedUrl === DEFAULT_MAP_TILE_PROVIDER_URL
        ? DEFAULT_MAP_TILE_LAYER_OPTIONS
        : CUSTOM_MAP_TILE_LAYER_OPTIONS,
    url: resolvedUrl,
  }
}

export type MapTileProvider = {
  options: TileLayerOptions
  url: string
}
