import { ImagePlus, Upload, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ImageUploadDropzoneProps = {
  buttonLabel?: string
  clearLabel?: string
  description?: string
  disabled?: boolean
  dropzoneClassName?: string
  file: File | null
  onFileChange: (file: File | null) => void
  title?: string
}

export function ImageUploadDropzone({
  buttonLabel = 'Choose image',
  clearLabel = 'Remove selected',
  description = 'PNG, JPG, or WebP work best',
  disabled = false,
  dropzoneClassName,
  file,
  onFileChange,
  title = 'Drop a cover image here',
}: ImageUploadDropzoneProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const previewUrl = useImagePreview(file)

  function clearFile() {
    if (inputRef.current) {
      inputRef.current.value = ''
    }
    onFileChange(null)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)

    if (disabled) {
      return
    }

    const nextFile = event.dataTransfer.files.item(0)
    if (nextFile?.type.startsWith('image/')) {
      onFileChange(nextFile)
    }
  }

  return (
    <div className="grid gap-3">
      <label
        className={cn(
          'group grid min-h-56 cursor-pointer place-items-center overflow-hidden rounded-2xl border border-dashed border-emerald-200 bg-white text-center shadow-sm transition-colors',
          isDragging && 'border-primary bg-emerald-50',
          disabled && 'cursor-not-allowed opacity-60',
          dropzoneClassName,
        )}
        htmlFor={inputId}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) {
            setIsDragging(true)
          }
        }}
        onDrop={handleDrop}
      >
        {previewUrl ? (
          <img
            alt="Selected trip cover preview"
            className="h-full max-h-80 w-full object-cover"
            src={previewUrl}
          />
        ) : (
          <div className="grid justify-items-center gap-3 px-5 py-10">
            <span className="grid size-12 place-items-center rounded-xl bg-emerald-50 text-primary shadow-sm">
              <ImagePlus className="size-6" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {title}
              </p>
              <p className="text-xs text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
        )}
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          accept="image/*"
          className="sr-only"
          disabled={disabled}
          id={inputId}
          onChange={(event) => {
            onFileChange(event.target.files?.item(0) ?? null)
          }}
          ref={inputRef}
          type="file"
        />
        <Button
          disabled={disabled}
          onClick={() => document.getElementById(inputId)?.click()}
          type="button"
          variant="outline"
        >
          <Upload className="size-4" aria-hidden="true" />
          {buttonLabel}
        </Button>
        {file ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {file.name}
            </p>
            <Button
              disabled={disabled}
              onClick={clearFile}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" aria-hidden="true" />
              {clearLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function useImagePreview(file: File | null) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const fileKey = useMemo(() => {
    if (!file) {
      return null
    }
    return `${file.name}:${file.size}:${file.lastModified}`
  }, [file])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return undefined
    }

    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)

    return () => URL.revokeObjectURL(objectUrl)
  }, [file, fileKey])

  return previewUrl
}
