import { ImageUploadDropzone } from '@/components/media/image-upload-dropzone'

import { getDefaultTripCoverName } from './default-trip-cover'

type TripCoverFieldProps = {
  disabled?: boolean
  file: File | null
  onFileChange: (file: File | null) => void
}

export function TripCoverField({
  disabled = false,
  file,
  onFileChange,
}: TripCoverFieldProps) {
  return (
    <div className="grid gap-2">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Cover image <span className="text-muted-foreground">(optional)</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Skip this to use the {getDefaultTripCoverName()} cover. You can upload
          a different cover later.
        </p>
      </div>
      <ImageUploadDropzone
        buttonLabel="Choose cover"
        description={`Optional. ${getDefaultTripCoverName()} is used if you skip this.`}
        disabled={disabled}
        dropzoneClassName="min-h-44"
        file={file}
        onFileChange={onFileChange}
        title="Drop a cover image here"
      />
    </div>
  )
}
