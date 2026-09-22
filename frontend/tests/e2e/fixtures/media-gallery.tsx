import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MediaLightbox } from '../../../src/pages/trip-detail/post-media-ui'
import '../../../src/index.css'

export function GalleryFixture() {
  const [index, setIndex] = useState<number | null>(null)
  return <>
    <button onClick={() => setIndex(0)}>Open gallery</button>
    {index !== null && <MediaLightbox activeIndex={index} onIndexChange={setIndex} onClose={() => setIndex(null)} title="Mountain memories"
      media={Array.from({ length: 8 }, (_, item) => ({ alt: `Photo ${item + 1}`, src: `/gallery-photo-${item}.svg`, thumbnail: `/gallery-thumb-${item}.svg` }))} />}
  </>
}

createRoot(document.getElementById('root')!).render(<GalleryFixture />)
