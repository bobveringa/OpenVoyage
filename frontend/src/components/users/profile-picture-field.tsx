import { RotateCcw, Trash2 } from 'lucide-react'

import type { CurrentUser } from '@/api/client'
import { ImageUploadDropzone } from '@/components/media/image-upload-dropzone'
import { Button } from '@/components/ui/button'
import { MediaImage } from '@/components/ui/media-image'
import {
  getUserInitials,
  getUserProfileMedia,
} from '@/lib/users'

type ProfilePictureFieldProps = {
  currentUser: CurrentUser
  disabled?: boolean
  file: File | null
  onFileChange: (file: File | null) => void
  onRemoveChange: (remove: boolean) => void
  removePicture: boolean
}

export function ProfilePictureField({
  currentUser,
  disabled = false,
  file,
  onFileChange,
  onRemoveChange,
  removePicture,
}: ProfilePictureFieldProps) {
  const currentPicture = getUserProfileMedia(currentUser)

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <MediaImage
          alt=""
          className="size-20 rounded-2xl shadow-sm"
          fallback={
            <span className="text-lg font-semibold">
              {getUserInitials(currentUser)}
            </span>
          }
          media={removePicture ? null : currentPicture}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">Profile picture</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Upload a square image if possible. The preview updates before saving.
          </p>
          {removePicture ? (
            <p className="text-sm font-medium text-destructive">
              Your current profile picture will be removed when you save.
            </p>
          ) : null}
        </div>
        {currentPicture ? (
          <Button
            disabled={disabled}
            onClick={() => {
              onFileChange(null)
              onRemoveChange(!removePicture)
            }}
            type="button"
            variant="outline"
          >
            {removePicture ? (
              <RotateCcw className="size-4" aria-hidden="true" />
            ) : (
              <Trash2 className="size-4" aria-hidden="true" />
            )}
            {removePicture ? 'Keep picture' : 'Remove'}
          </Button>
        ) : null}
      </div>

      <ImageUploadDropzone
        buttonLabel="Choose picture"
        clearLabel="Remove selected"
        description="PNG, JPG, or WebP. You can change this again later."
        disabled={disabled}
        dropzoneClassName="min-h-44"
        file={file}
        onFileChange={(nextFile) => {
          onFileChange(nextFile)
          if (nextFile) {
            onRemoveChange(false)
          }
        }}
        title="Drop a profile picture here"
      />
    </div>
  )
}
