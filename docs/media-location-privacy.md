# Media location privacy

## Scope

- Clean all future image/video uploads, including Immich imports, for posts, map bubbles, comments, profile pictures and trip covers.
- Remove embedded descriptive metadata: GPS/location, capture dates, camera/device details, descriptions, EXIF/XMP/IPTC and equivalent video metadata.
- Preserve only information needed for correct display/playback, including orientation, colour profiles, video colour information and timing. Apply image orientation to pixels where practical; never preserve an entire metadata block just to keep orientation.
- Existing stored media is not reprocessed. Explicitly entered post locations, captions and dates are unaffected.
- Supported formats remain JPEG, PNG, WebP, MP4 and WebM.

## Upload and processing

Media uses `UPLOADED -> PROCESSING -> READY` or `UPLOADED -> PROCESSING -> FAILED`. `UPLOADED` means the file is stored privately and waiting for the background task; `PROCESSING` means the task has started. Startup recovery may also transition interrupted `UPLOADED` or `PROCESSING` records directly to `FAILED`. This is an alpha change; backward compatibility with existing records is not required.

1. Validate the upload's type/size, store it in the private staging directory, create its media record as `UPLOADED`, and return immediately after storage. Do not wait for inspection, cleaning or thumbnail generation.
2. Extend the existing server background task to persist `PROCESSING` when it starts, then clean the file, extract dimensions/duration from the cleaned output, and generate a clean thumbnail.
3. Write cleaned content and thumbnails to staging, then atomically move each completed output into permanent storage. Update the stored paths and set `READY` only after both outputs are complete, technical information is saved, and all staging files, including the unclean original, are removed. The readiness check blocks access throughout promotion.
4. On processing failure, remove all associated staging files and any promoted outputs and set `FAILED`. Keep the record available for status polling. The user removes/reuploads the file; there is no processing retry endpoint. Upload/import failures before record creation must also remove their staging files.

Use shared image/video cleaning functions. Only allowlisted display/playback information survives. Video cleaning must remove metadata from containers and streams, including location-bearing data/telemetry tracks and attachments; preserve audio/video playback and avoid re-encoding where safe. If safe cleaning cannot be completed, fail processing.

Originals and temporary files must never be directly accessible through static hosting or media endpoints, even to the uploader or through a signed URL. Do not extract embedded location data into application records or logs. Thumbnails must also meet the metadata policy.

Keep the current background-task approach; no new queue service. Use timeouts for external processing commands.

Use one dedicated private staging directory for incoming uploads, Immich downloads and all processing outputs. Keep staging on the same filesystem as permanent media storage so promotion can use atomic moves. Assign a media UUID before writing files and group staging files by that UUID; any promoted output must also be identifiable by that UUID, even if its final path has not yet been committed to the database. Only cleaned content and thumbnails are promoted into permanent storage.

For the current single-process deployment, run startup recovery before accepting requests or starting workers:

- Mark interrupted `UPLOADED` and `PROCESSING` records `FAILED` and remove their staging files and any promoted outputs associated with those IDs. Retain the records for status polling.
- Clear all remaining staging files, including abandoned uploads and Immich downloads with no database record. Cleanup must scan the staging directory directly rather than rely only on database records.

Extend orphan cleanup to cover abandoned staging files as well as stored content/thumbnails. Runtime cleanup must skip active uploads, Immich downloads and background processing, including operations that have not yet created a database record.

## Client behaviour

- Preserve existing selection, immediate post uploads, local previews and upload progress. After transfer completes, show **Waiting to process…** for `UPLOADED` and **Processing…** for `PROCESSING`.
- Users can select media and continue editing while it waits or processes. Keep local previews until clean server previews are available. Immich imports remain selectable while waiting or processing.
- Extend the existing post submission wait: saving drafts, saving edits and publishing wait for all selected media to become `READY`, then complete the requested action once.
- Apply the same wait to comments, profile pictures and trip covers, preserving their existing upload timing.
- Poll each `UPLOADED` or `PROCESSING` media item every two seconds. Stop at `READY`/`FAILED`, removal or navigation; processing continues on the server. Temporary network errors allow waiting to resume and are not treated as processing failure.
- On `FAILED`, cancel the pending save, retain the form and show **Processing failed. Remove this file and upload it again.** Users can remove the failed item and save with the remaining ready media.

Server validation also rejects attempts to attach media that is not `READY`. Check after existing permission/ownership validation and before making any changes. Requests without new media follow their existing behaviour.

## API changes

All paths below start with `/api/v1`. Existing authentication, ownership checks and post revision headers remain in use.

### Upload and polling

**Changed: `POST /media`**

Request: unchanged `multipart/form-data`, field `file` containing the image/video.

Response: `201 Created`, the shared media response with status `UPLOADED`. Example:

```json
{
  "id": "<media UUID>",
  "media_type": "IMAGE",
  "status": "UPLOADED",
  "urls": { "content": null, "thumbnail": null },
  "metadata": {
    "caption": "",
    "created_at": "2026-10-07T12:00:00Z",
    "updated_at": "2026-10-07T12:00:00Z"
  },
  "technical_info": null
}
```

**New: `GET /media/{media_id}`**

Request body: none. Authenticated upload owner only; unknown/other users' IDs return `404`.

Response: `200 OK`, the same media response. `READY` includes signed content/thumbnail URLs and technical information; `UPLOADED`, `PROCESSING` and `FAILED` have null URLs and technical information. Use `Cache-Control: private, no-store`. Update the shared media response schema and generated frontend types to allow these null values and the statuses `UPLOADED`, `PROCESSING`, `READY` and `FAILED`.

**Changed: `GET /media/{media_id}/content`**, including `?thumbnail=true` and video range requests.

Request body: none. After access checks, return `409` for media that is not `READY`, including signed requests:

```json
{ "detail": "Media is not ready" }
```

Ready content continues to use the existing download/streaming behaviour.

### Immich

**Changed: `POST /trips/{trip_id}/immich/albums/{link_id}/imports`**

Request body:

```json
{ "asset_id": "<Immich asset UUID>" }
```

Download the asset into the managed private staging directory and use the same upload/storage lifecycle; any intermediate download files must also remain in staging. After fetching/storing the asset, return `201` with the same `UPLOADED` response as an upload. Use the same background processing and polling endpoint.

**Changed: `GET /trips/{trip_id}/immich/albums/{link_id}/assets/{asset_id}/thumbnail` and `/display-image`**

Request body: none. These picker preview proxies must clean the upstream image with the shared image cleaner before returning bytes, preserving their existing access checks and private/no-store caching. Fail the preview request rather than return unclean bytes. They do not create media records; imported originals still use asynchronous processing.

### Attachment validation

Request schemas are unchanged. The following endpoints add the readiness check; bodies below are examples, with existing optional fields still supported.

| Endpoint | Request body |
| --- | --- |
| `POST /trips/{trip_id}/posts` | `{"title":"A day away","body":"Our story","location":{"latitude":52.37,"longitude":4.90},"occurred_at":"2026-10-07T12:00:00Z","media_ids":["<media UUID>"],"bubble_media_id":"<media UUID>","publish":false}` |
| `PATCH /trips/{trip_id}/posts/{post_id}` | `{"media_ids":["<media UUID>"],"bubble_media_id":"<media UUID>"}` |
| `POST /trips/{trip_id}/posts/{post_id}/publish` | None; validate attached media before publishing. |
| `POST /trips/{trip_id}/posts/{post_id}/comments` | `{"body":"Lovely!","parent_comment_id":null,"media_id":"<media UUID>"}` |
| `POST /trips` | `{"name":"Summer trip","description":"","media_id":"<media UUID>","visibility":"PRIVATE","start_date":"2026-10-07","end_date":null}` |
| `PATCH /trips/{trip_id}` | `{"media_id":"<media UUID>"}` |
| `PATCH /users/me` | `{"profile_picture_media_id":"<media UUID>"}` |

For referenced media that is not ready, return `409` without saving any part of the request:

```json
{
  "detail": {
    "code": "MEDIA_NOT_READY",
    "media_ids": ["<media UUID>"]
  }
}
```

## Verification

- Metadata-bearing fixtures for every supported format produce clean content and thumbnails; independently inspect outputs for location/descriptive metadata. Check image/video orientation, colour and audio/playback preservation.
- Upload and import responses return `UPLOADED` before processing starts. The background task persists `PROCESSING` when it starts and reaches `READY` or `FAILED`. Content access is blocked for `UPLOADED`, `PROCESSING` and `FAILED`, including signed URLs, thumbnails and video ranges.
- Polling respects ownership, continues through `UPLOADED` and `PROCESSING`, and exposes both terminal states. Failures/restarts remove originals and partial files; startup recovery marks both waiting and active records `FAILED`.
- Simulate crashes during upload and Immich download before record creation, while waiting/processing, and after output promotion but before the `READY` commit. Startup recovery removes abandoned staging files without database records and any promoted outputs belonging to interrupted records. Runtime orphan cleanup preserves active uploads/imports and processing files.
- Every attachment endpoint rejects non-ready media without partial writes. Client saves wait and run once, retain input on failure, and recover after removing/reuploading failed media.
- Immich preview responses and imported media follow the same metadata policy.
