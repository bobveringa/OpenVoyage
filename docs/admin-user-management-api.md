v# Admin user-management API specification

## Purpose and scope

This document specifies the new administrator-only endpoints for creating and
managing application users.  They are additive to the existing public
`/api/v1/users` endpoints and the one-time bootstrap endpoint
`POST /api/v1/admin/first-user`.

The endpoints use a flat user representation.  In particular, profile fields
are not nested below `profile`, email is available to administrators, and a
password hash is never returned.  Profile-picture media is intentionally out
of scope: users continue to manage their own picture through `PATCH /users/me`.

All endpoints below require a bearer access token for an `ADMIN` user.  A
missing or invalid token returns `401`; an authenticated non-admin returns
`403`.

Base URL: `/api/v1`

## Shared response body

Every successful endpoint returns the following flat `AdminUser` object,
either directly or in a `users` array:

```json
{
  "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
  "email": "maya@example.com",
  "username": "maya-travels",
  "first_name": "Maya",
  "last_name": "Chen",
  "role": "USER",
  "created_at": "2026-08-11T18:00:00Z",
  "updated_at": "2026-08-11T18:00:00Z"
}
```

Field rules:

- `id` is a UUID string.
- `email` is normalized to lowercase before it is stored and returned.
- `role` is either `USER` or `ADMIN`.
- `username` follows the existing username rules: 3–32 characters, letters,
  numbers, `.`, `_`, and `-`; no leading/trailing or consecutive separators.
  Usernames remain unique case-insensitively and ignoring separators.
- `first_name` and `last_name` are strings of at most 255 characters. They may
  be empty when updated.
- timestamps are ISO 8601 UTC date-time strings.

## Endpoints

### Create a user

`POST /admin/users`

Creates a user and profile. `role` is optional and defaults to `USER`.

Request body:

```json
{
  "email": "maya@example.com",
  "password": "MayaSecurePass123!",
  "username": "maya-travels",
  "first_name": "Maya",
  "last_name": "Chen",
  "role": "USER"
}
```

Success: `201 Created`

```json
{
  "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
  "email": "maya@example.com",
  "username": "maya-travels",
  "first_name": "Maya",
  "last_name": "Chen",
  "role": "USER",
  "created_at": "2026-08-11T18:00:00Z",
  "updated_at": "2026-08-11T18:00:00Z"
}
```

`password` must be 8–128 characters. A duplicate email or username returns
`409 Conflict`.

### List users

`GET /admin/users?page=1&page_size=20&query=maya&role=USER`

Lists users ordered by email, then id. All query parameters are optional:

- `page`: one-based page number; default `1`.
- `page_size`: `1`–`100`; default `20`.
- `query`: case-insensitive substring search across email, username, first
  name, and last name.
- `role`: exact role filter, `USER` or `ADMIN`.

Success: `200 OK`

```json
{
  "users": [
    {
      "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
      "email": "maya@example.com",
      "username": "maya-travels",
      "first_name": "Maya",
      "last_name": "Chen",
      "role": "USER",
      "created_at": "2026-08-11T18:00:00Z",
      "updated_at": "2026-08-11T18:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

An empty result is `200 OK` with `users: []` and `total: 0`.

### Get one user

`GET /admin/users/{user_id}`

Success: `200 OK`

```json
{
  "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
  "email": "maya@example.com",
  "username": "maya-travels",
  "first_name": "Maya",
  "last_name": "Chen",
  "role": "USER",
  "created_at": "2026-08-11T18:00:00Z",
  "updated_at": "2026-08-11T18:00:00Z"
}
```

A missing user returns `404 Not Found`.

### Update a user

`PATCH /admin/users/{user_id}`

Updates only fields present in the request body. This is also the admin
password-reset operation; password changes are never reflected in the
response.

Request body example:

```json
{
  "email": "maya.chen@example.com",
  "first_name": "Maya",
  "role": "ADMIN",
  "password": "NewMayaPass123!"
}
```

Success: `200 OK`

```json
{
  "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
  "email": "maya.chen@example.com",
  "username": "maya-travels",
  "first_name": "Maya",
  "last_name": "Chen",
  "role": "ADMIN",
  "created_at": "2026-08-11T18:00:00Z",
  "updated_at": "2026-08-11T18:10:00Z"
}
```

The permitted request fields are `email`, `password`, `username`,
`first_name`, `last_name`, and `role`. All are optional; at least one must be
provided. Field validation is the same as for creation. A duplicate email or
username returns `409 Conflict`; a missing user returns `404 Not Found`.

An administrator cannot change their own role, nor can they demote the last
remaining administrator. Either case returns `409 Conflict`.

### Delete a user

`DELETE /admin/users/{user_id}`

Permanently deletes the user and their profile. Related records retain the
database behaviour already defined for the user relationship (for example,
trip memberships are deleted through their cascade).

Success: `200 OK`

```json
{
  "id": "4be494d8-b4e5-44cf-83e5-16780d3154a4",
  "deleted": true
}
```

A missing user returns `404 Not Found`. An administrator cannot delete their
own account or the last remaining administrator; either returns `409 Conflict`.

## Error response body

All specified non-validation errors use the same small body:

```json
{
  "detail": "User not found"
}
```

FastAPI request-validation failures use its standard `422 Unprocessable
Content` body with `detail` entries that identify invalid request fields.

## Status-code summary

| Situation | Status |
| --- | --- |
| User created | `201 Created` |
| User read, listed, updated, or deleted | `200 OK` |
| Invalid or missing bearer token | `401 Unauthorized` |
| Authenticated user is not an admin | `403 Forbidden` |
| User does not exist | `404 Not Found` |
| Duplicate email/username or protected admin action | `409 Conflict` |
| Invalid request data | `422 Unprocessable Content` |

## Implementation notes

- Add these routes under the existing `/admin` router and protect all of them
  with the existing `CurrentAdmin` dependency.
- Use admin-specific request/response models rather than extending the public
  `UserResponse`; email must remain absent from public user responses.
- The existing `POST /admin/first-user` stays unauthenticated and remains
  available only while no users exist. It is not a replacement for
  `POST /admin/users`.
