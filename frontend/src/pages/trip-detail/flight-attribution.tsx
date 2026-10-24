const sources = {
  aerodatabox: { name: 'AeroDataBox', url: 'https://aerodatabox.com/' },
  flightaware: { name: 'FlightAware', url: 'https://www.flightaware.com/' },
}

export function FlightAttribution({ providers, approximate = false }: { providers: (string | undefined)[]; approximate?: boolean }) {
  const selected = Object.entries(sources).filter(([key]) => providers.includes(key))
  if (!selected.length) return null
  return <p className="text-xs text-muted-foreground">Flight information from {selected.map(([key, source], index) =>
    <span key={key}>{index ? ', ' : ''}<a href={source.url} target="_blank" rel="noopener" className="underline">{source.name}</a></span>,
  )}.{approximate ? ' Flight lines are approximate.' : ''}</p>
}
