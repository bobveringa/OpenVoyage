import type { GpsPostCandidate, MediaUploadProgress } from '@/api/client'
import {
  formatDateTimeInputValue,
  parseDateTime,
} from '@/pages/trip-detail/date-utils'
import type { PostMedia } from '@/pages/trip-detail/models'
import type {
  DraftMediaUploadState,
  DraftPostMedia,
  PostSubmitIntent,
} from '@/pages/trip-detail/page-types'

export function isSupportedMediaFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

export function getPostMediaType(file: File): NonNullable<PostMedia['type']> {
  return file.type.startsWith('video/') ? 'video' : 'image'
}

export function createExistingDraftPostMedia(media: PostMedia): DraftPostMedia {
  return {
    ...media,
    clientId: createDraftMediaClientId(),
    upload: {
      error: null,
      loadedBytes: null,
      mediaId: media.media_id ?? null,
      progress: null,
      status: media.media_id ? 'existing' : 'uploaded',
      totalBytes: null,
    },
  }
}

export function createNewDraftPostMedia(
  file: File,
  src: string,
): DraftPostMedia {
  return {
    alt: file.name,
    clientId: createDraftMediaClientId(),
    file,
    src,
    type: getPostMediaType(file),
    upload: {
      error: null,
      loadedBytes: null,
      mediaId: null,
      progress: null,
      status: 'queued',
      totalBytes: file.size,
    },
  }
}

export function toPostMediaFromDraft(media: DraftPostMedia): PostMedia {
  return {
    alt: media.alt,
    file: media.file,
    media_id: media.media_id ?? media.upload.mediaId ?? undefined,
    poster: media.poster,
    src: media.src,
    thumbnail: media.thumbnail,
    type: media.type,
  }
}

export function updateDraftMediaUpload(
  media: readonly DraftPostMedia[],
  clientId: string,
  updates: Partial<DraftMediaUploadState>,
): DraftPostMedia[] {
  return media.map((item) =>
    item.clientId === clientId
      ? {
          ...item,
          upload: {
            ...item.upload,
            ...updates,
          },
        }
      : item,
  )
}

export function toDraftMediaProgressUpdate(
  progress: MediaUploadProgress,
): Partial<DraftMediaUploadState> {
  return {
    loadedBytes: progress.loaded,
    progress: progress.progress,
    totalBytes: progress.total,
  }
}

export function getDraftMediaUploadSummary(media: readonly DraftPostMedia[]) {
  return media.reduce(
    (summary, item) => {
      summary.total += 1
      if (isDraftMediaUploadReady(item)) {
        summary.ready += 1
      }
      if (item.upload.status === 'queued' || item.upload.status === 'uploading') {
        summary.pending += 1
      }
      if (item.upload.status === 'uploading') {
        summary.uploading += 1
      }
      if (item.upload.status === 'failed') {
        summary.failed += 1
      }
      return summary
    },
    {
      failed: 0,
      pending: 0,
      ready: 0,
      total: 0,
      uploading: 0,
    },
  )
}

export function getDraftMediaSectionDescription(
  mediaCount: number,
  uploadSummary: ReturnType<typeof getDraftMediaUploadSummary>,
) {
  if (mediaCount === 0) {
    return 'Add photos or videos to build the post gallery.'
  }
  if (uploadSummary.failed > 0) {
    return `${uploadSummary.failed} ${uploadSummary.failed === 1 ? 'upload needs' : 'uploads need'} attention.`
  }
  if (uploadSummary.pending > 0) {
    return `Uploading ${uploadSummary.ready} of ${uploadSummary.total}.`
  }
  return `${mediaCount} ${mediaCount === 1 ? 'media item' : 'media items'} · first visual becomes the map bubble.`
}

export function getDraftMediaUploadSummaryLabel(
  uploadSummary: ReturnType<typeof getDraftMediaUploadSummary>,
) {
  if (uploadSummary.failed > 0) {
    return `${uploadSummary.failed} ${uploadSummary.failed === 1 ? 'upload failed' : 'uploads failed'}`
  }
  if (uploadSummary.pending > 0) {
    return `Uploading ${uploadSummary.ready} of ${uploadSummary.total}`
  }
  return 'Uploads complete'
}

export function getFinishingUploadsModalDescription(intent?: PostSubmitIntent) {
  if (intent === 'draft') {
    return 'The draft will be saved once the remaining media is uploaded.'
  }
  if (intent === 'save') {
    return 'The post will be saved once the remaining media is uploaded.'
  }
  return 'The post will publish once the remaining media is uploaded.'
}

export function getDraftMediaUploadStatusText(media: DraftPostMedia) {
  if (media.upload.status === 'existing') {
    return 'Uploaded'
  }
  if (media.upload.status === 'queued') {
    return 'Queued'
  }
  if (media.upload.status === 'uploading') {
    return media.upload.progress === null
      ? 'Uploading'
      : `Uploading ${Math.round(media.upload.progress * 100)}%`
  }
  if (media.upload.status === 'uploaded') {
    return 'Uploaded'
  }
  return 'Failed'
}

export function isDraftMediaUploadReady(media: DraftPostMedia) {
  return media.upload.status === 'existing' || media.upload.status === 'uploaded'
}

export function isDraftMediaUploadBlocking(media: DraftPostMedia) {
  return (
    media.upload.status === 'queued' ||
    media.upload.status === 'uploading' ||
    media.upload.status === 'failed'
  )
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export function toPostOccurredAtValue(value: string) {
  const date = parseDateTime(value)
  return date ? date.toISOString() : value
}

export function createDraftMediaClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `draft-media-${crypto.randomUUID()}`
  }

  return `draft-media-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function formatGpsPostCandidateOccurredAt(candidate: GpsPostCandidate) {
  const recordedAt = new Date(candidate.recorded_at)
  return formatDateTimeInputValue(
    Number.isNaN(recordedAt.getTime()) ? null : recordedAt,
  )
}
