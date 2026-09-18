# Shared Post Collaboration and Media Conflict Resolution

## Status

Proposed. This document specifies the behaviour and API contract for allowing
trip members to collaboratively edit one post without rejecting valid media or
silently overwriting another editor's work. It does not implement the change.

## Problem

Posts are attached to a trip, but their editing rules are effectively
author-centric:

- A member can create a post but cannot edit a post written by another member.
- The owner may edit a member's post, but cannot save it when its media was
  uploaded by that member: media validation requires every selected item to be
  owned by the user performing the save.
- The editor submits the whole ordered media list with every save. Therefore a
  text-only owner edit can fail merely because the post already has
  contributor-owned media.
- A media update replaces the whole list. Two editors with stale copies can
  otherwise overwrite each other's additions, removals, and ordering.

## Goals

1. Treat a post on a trip as a shared, collaboratively editable resource.
2. Allow a permitted current trip member to retain, reorder, and remove
   existing contributor media while preserving its attribution.
3. Keep media private to the trip and prevent attachment of an outsider's
   media.
4. Detect stale saves before a whole-list media replacement can discard another
   editor's work.
5. Use the established itinerary `ETag` / `If-Match` convention for a
   consistent API.
6. Preserve the existing private-media invariant: an unattached upload is
   readable only by its uploader or through a valid signed media capability
   that the uploader deliberately shares.

## Non-goals

- Real-time cursors, presence, field-level merging, or CRDT editing.
- Changing who may view a post or media.
- Letting a member newly attach media uploaded by another person, including a
  current trip member.
- Changing the binary-upload endpoint or ownership of a media record.

## Authorization policy

`UPDATE_POST` becomes the single authority for changing a post. Any current
trip member whose role has that permission may update any post in that trip;
authorship remains display/audit metadata, not an edit lock.

The current role matrix already grants `UPDATE_POST` to `OWNER` and `MEMBER`.
This proposal makes the post service honor that matrix instead of imposing its
additional author-or-owner check.

The scope of this change is editing (`PATCH`). Existing publish, unpublish, and
delete authorization remains unchanged: the author or trip owner may perform
those operations. A later product decision can broaden those actions
independently.

### Eligible media

For a collaborative update, each requested media item must satisfy one of the
following rules:

1. It is already attached to the post being edited; it may be retained or
   reordered even if its uploader has since left the trip.
2. It is being newly attached and its `created_by` value is the current editor's
   user id.

The request is rejected if a media id does not exist, was uploaded by a user
other than the current editor, has no attributable creator, or is repeated
within the list. This preserves contributor control over unused uploads and
prevents users from attaching arbitrary media they can guess the id of.

For post creation, every requested item must meet rule 2; rule 1 cannot apply.
In other words, an author may create a post only with media they uploaded. A
collaborator adds their own media later through a revision-checked edit.

### Media access and deliberate sharing

Collaboration must not make a private upload readable merely because the
uploader and another user belong to the same trip, because the other user can
edit posts, or because the other user knows the media id. Until it is shared,
the media content endpoint returns `404 Not Found` to everyone except the
uploader. Using `404` avoids disclosing whether a guessed private media id
exists.

For this proposal, the uploader deliberately shares media in either of the
ways already supported by the application:

1. The uploader attaches their own media to a post. Readers then receive access
   according to the existing post publication and trip-read rules. Attaching
   media to a draft does not make that media public; only users allowed to read
   the draft may read it.
2. The uploader gives another person a valid signed media URL. The token is a
   bearer capability and grants access only to the media id encoded in that
   token for the token's lifetime.

Allowing another editor to retain or reorder media already attached to the
same post does not establish a new sharing grant: that media was already shared
through that post. It must not let the editor attach the media to another post
or obtain access to any other private uploads from the same uploader.

## Concurrency model

Each post gains an integer `revision` that starts at `0`, matching
`trips.itinerary_revision`. Every successful mutation that changes persisted
post state increments it exactly once:

- `PATCH` (including media-only edits),
- publish,
- unpublish.

A successful no-op does not increment the revision. For example, an empty or
unchanged `PATCH`, publishing an already-published post, or unpublishing an
already-unpublished post returns the current representation and unchanged
`ETag`. The revision precondition is still checked before determining that a
request is a no-op, so a stale no-op request returns `412`.

Deletion checks the current revision but, naturally, returns no replacement
revision. Post responses expose the numeric revision in the body and a matching
quoted `ETag`. A client sends that revision as `If-Match: "<revision>"` for
every mutation of an existing post. The server performs the comparison and
write in one transaction while locking the post row. A mismatch returns `412
Precondition Failed` and leaves the post and its media links unchanged.

This is optimistic concurrency: the client refreshes the post and asks the
editor to review/reapply its changes. The server does not attempt an unsafe
automatic merge of ordered media lists.

## Data model and migration

### `posts` table change

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `revision` | integer | no | `0` | Monotonically increasing version for optimistic concurrency. |

Migration requirements:

1. Add `posts.revision` with server default `0` and backfill existing rows.
2. Enforce `NOT NULL` and a non-negative-value check (`revision >= 0`).
3. Map the column in the ORM model and expose it in post responses.
4. Do not alter `media.created_by` or the `post_media` schema; the validation
   rule changes in the service layer.

## HTTP API contract

Base path: `/api/v1/trips/{trip_id}/posts`.

### Route inventory

No new routes are required. The following existing routes change:

| Method and path | Change |
| --- | --- |
| `POST /` | Returns an `ETag`; every attached item must be uploaded by the creator. |
| `GET /` | Each post in the body now includes `revision`. |
| `GET /timeline` | Each nested post now includes `revision`. |
| `GET /{post_id}` | Returns an `ETag` and body `revision`. |
| `PATCH /{post_id}` | Requires `If-Match`; shared-member editing and collaborative media validation apply. |
| `POST /{post_id}/publish` | Requires `If-Match`; returns the current revision and `ETag`, incremented when state changes. |
| `POST /{post_id}/unpublish` | Requires `If-Match`; returns the current revision and `ETag`, incremented when state changes. |
| `DELETE /{post_id}` | Requires `If-Match`; verifies revision before deletion. |

`GET /` and `GET /timeline` do not return a single resource `ETag`, because
their payloads contain multiple independently-versioned posts.

### Changed response body: `PostResponse`

Add this required field to every response containing a post:

```json
{
  "id": "4c6c6eba-c6e6-4a14-b3a7-813979055c6c",
  "revision": 7,
  "title": "Arrival in Lisbon",
  "media": []
}
```

All existing post fields remain unchanged.

### `POST /api/v1/trips/{trip_id}/posts`

Request body is unchanged:

```json
{
  "title": "Arrival in Lisbon",
  "body": "We made it.",
  "location": { "place_id": "123" },
  "occurred_at": "2026-09-18T09:30:00Z",
  "media_ids": ["0e33eb43-57fe-4b6c-8f5f-8be1a0712744"],
  "publish": false
}
```

Success remains `201 Created`. The response body includes `revision: 0` and
the response header is `ETag: "0"`. Every media item in the request must have
been uploaded by the post creator.

### `GET /api/v1/trips/{trip_id}/posts/{post_id}`

Response body gains `revision`. A successful response includes a matching ETag:

```http
ETag: "7"
```

### `PATCH /api/v1/trips/{trip_id}/posts/{post_id}`

Request body remains a partial post update; no revision field is added to the
JSON body. The revision is conveyed by a required HTTP header:

```http
If-Match: "7"
Content-Type: application/json
```

```json
{
  "body": "We made it, just in time for sunset.",
  "media_ids": [
    "0e33eb43-57fe-4b6c-8f5f-8be1a0712744",
    "794436d2-8cf6-47da-8a07-b660c1bb2d5b"
  ]
}
```

`media_ids`, when supplied, is still the complete ordered replacement list.
It can include any currently attached media (which the editor may retain,
reorder, or remove) plus new media uploaded by that same editor. It cannot add
an unused item uploaded by another collaborator. Any current member with
`UPDATE_POST` may send this request.

On success, return `200 OK`, the updated post with `revision: 8`, and:

```http
ETag: "8"
```

### Publish, unpublish, and delete

These routes add no JSON request body. They require the same header:

```http
If-Match: "7"
```

Successful publish/unpublish returns the current post and matching `ETag`; the
revision is incremented only when publication state changes.
Successful delete remains `204 No Content`.

### Error responses

| Status | Condition | Example detail |
| --- | --- | --- |
| `403 Forbidden` | Caller lacks the required trip permission, or attempts to newly attach media uploaded by another user. | `New post media must be uploaded by the editor` |
| `404 Not Found` | Trip, post, or requested media id is absent. | Existing not-found behaviour |
| `400 Bad Request` | A media id occurs more than once. | `Post media ids must be unique` |
| `428 Precondition Required` | Mutation of an existing post has no `If-Match`. | `If-Match header is required` |
| `422 Unprocessable Content` | `If-Match` is not a quoted non-negative integer or the normal payload validation fails. | `If-Match must be a quoted integer revision` |
| `412 Precondition Failed` | `If-Match` does not equal the current post revision. | `Post revision does not match` |

As with itinerary updates, `412` uses the standard error response containing
the `detail` above; it does not include a post representation or `ETag`. The
attempted changes are never applied. A client that needs the current post
performs a fresh `GET /{post_id}`.

## Client behaviour

1. Store the numeric `revision` whenever a post is loaded or saved and format
   it as the quoted `If-Match` value, following the itinerary client pattern.
2. Supply `If-Match` for edit, publish, unpublish, and delete requests.
3. When editing, preserve ids that came from existing post media regardless of
   uploader. Newly selected files are uploaded under, and attached by, the
   current user only.
4. On `412`, keep the user's unsaved draft in memory, fetch the current post,
   display that another member changed it, and provide **Reload current post**
   and **Review changes** actions. Reload must not discard the local draft
   until the user confirms.
5. After a successful mutation, replace local post state with the server
   response, including its revision.
6. When one UI action performs multiple mutations, use the revision returned
   by each response for the next request. In particular, the existing
   edit-then-publish or edit-then-unpublish flow must send the revision returned
   by `PATCH` as the publication request's `If-Match` value.

## Backend implementation outline

1. Add the migration and ORM `Post.revision` mapping.
2. Add post-level `ETag` formatting/parsing helpers, aligned with the
   itinerary router's quoted integer format.
3. Load the post with `FOR UPDATE` for revision-checked mutations; compare the
   supplied revision before changing fields or media links.
4. Replace the author-or-owner gate for `PATCH` with `UPDATE_POST` permission.
5. Replace the current all-items editor-ownership check with the eligibility
   rules above: compare requested ids with existing `post_media` links, allow
   retained attachments, and require the current editor to own each newly added
   id in the same transaction.
6. After the precondition check, detect no-op requests using the same convention
   as the itinerary service. Bump revision once only when persisted post state
   changes, and return the current revision in the response and `ETag`.
7. Regenerate OpenAPI and TypeScript client types after the API models and
   headers change.

## Acceptance tests

- A member can edit another member's post when both belong to the trip.
- An owner can edit a contributor-authored post while retaining that
  contributor's media.
- A member can add media they uploaded to another member's post.
- A member cannot newly add media uploaded by another current member,
  a non-member, an unattributed upload, or a nonexistent id.
- Existing attachment from a departed member remains saveable on its current
  post but cannot be attached to a different post.
- Omitted or malformed `If-Match` returns `428` or `422` respectively.
- `If-Match: "0"` is valid syntax and can update a newly created post; a
  well-formed but stale revision returns `412`.
- Two clients saving revision 7: the first succeeds at revision 8; the second
  receives `412`, and its attempted media replacement is not persisted.
- A no-op edit, repeated publish, or repeated unpublish returns the unchanged
  revision; a stale no-op still returns `412`.
- Publish, unpublish, and delete also reject stale revisions.
- An edit followed by publish or unpublish in one UI action passes the revision
  returned by the edit into the second request.
- Backend integration tests exercise the real media-content endpoint, not only
  service validation or response metadata, and prove all of the following:
  - The uploader can read an unattached private upload with their authenticated
    request.
  - A different trip owner, member, viewer, unrelated authenticated user, and
    anonymous caller each receive `404` for that same unattached media id.
    Merely knowing the id or sharing a trip with the uploader grants no access.
  - Another editor cannot attach the uploader's private, previously unattached
    media to a post; the update returns `403`, the post is unchanged, and the
    media remains unreadable to that editor.
  - After the uploader deliberately attaches their media to a post, direct
    authenticated access follows the existing draft/published-post and trip
    access rules. Users without access to the post still receive `404`.
  - A post reader who receives a signed media URL can load it without separate
    authentication. A missing, malformed, expired, or media-id-mismatched token
    does not grant access.
  - Retaining or reordering already-attached contributor media during another
    member's edit keeps the content readable to the same post audience and
    preserves the original uploader attribution.
  - Removing the media from its only post removes post-derived access for other
    users; the uploader retains access. This assertion uses an unsigned request:
    previously issued signed URLs remain bearer capabilities until they expire.
- API generation, backend integration tests, frontend unit tests, and the
  relevant Playwright collaboration flow pass.

## Rollout and compatibility

This is an intentional API contract change for clients that mutate posts: they
must first obtain the post revision and send it as `If-Match`. Ship the backend
migration and API/client update together. Older clients will receive `428` on
post mutation, which is safer than continuing to permit lost media updates.
