# Frontend Design Guidelines

These are lightweight rules for the first frontend pass. They should guide page
structure and navigation without becoming a full design system.

## General

- Every page must work well from 320px mobile screens up to desktop.
- Start mobile-first, then enhance larger screens with additional columns,
  persistent side panels, and larger maps.
- Prefer clear, practical layouts over marketing-style sections. This is a
  travel blog and trip-management app, so the important content is users, trips,
  posts, media, maps, and admin actions.
- Reuse the existing React, Tailwind, theme token, layout, and shared UI
  component patterns from `frontend/src`.
- Ignore the current landing page as a style reference. It is a temporary
  baseline and should not constrain the login, user trip overview, trip detail,
  or admin screens.
- Keep navigation predictable: the same route should show the same page whether
  the viewer is authenticated or not, with actions gated by permissions.
- Keep components small and reusable. Page files should compose smaller pieces
  instead of holding all layout, controls, fetching states, and item rendering in
  one component.
- Use `class-variance-authority` (`cva`) when a reusable component has meaningful
  variants such as status badges, segmented controls, empty states, trip cards,
  icon buttons, or panel density. Do not use `cva` for one-off page layout.
- Prefer reusable components for common travel objects: trip cards, trip status
  badges, itinerary stop rows, post list items, map markers, user menu entries,
  loading states, empty states, and modal shells.

## Forms And Modals

- Forms should almost never be permanently displayed on normal pages. Pages
  should stay focused on reading, scanning, navigation, and clear primary
  actions.
- Prefer opening create, edit, upload, and configuration forms in modal dialogs
  or other focused overlays such as sheets when the task benefits from more
  space on mobile.
- Page-level forms are acceptable only when the form is the page's primary
  purpose, such as login, first-time setup, or a dedicated focused workflow.
- Inline controls are fine for lightweight filtering, sorting, search, toggles,
  and one-click actions, but avoid embedding full create or edit forms inside
  lists, panels, or detail pages.
- Modal form components should be reusable and action-oriented, for example
  `AddTripModal`, `AddStopModal`, `EditStopModal`, `AddPostModal`, and
  `UploadMediaModal`.
- Media upload flows should support drag and drop when the browser and device
  make that practical, with a clearly styled upload button as the reliable
  fallback.
- After a user selects or drops media, show an immediate preview before final
  submission. Image uploads should show the actual image thumbnail or larger
  preview; unsupported preview types should show a clear file summary.

## Routes And Pages

- Each distinct page should live in its own `.tsx` file. Avoid adding new route
  screens directly inside `App.tsx`.
- Suggested page files:
  - `frontend/src/pages/login-page.tsx`
  - `frontend/src/pages/trip-detail-page.tsx`
  - `frontend/src/pages/user-page.tsx`
  - `frontend/src/pages/admin-page.tsx`
  - `frontend/src/pages/setup-page.tsx`
- `/` should render the login page while there is no separate public landing
  experience. If `/login` is added later, it should reuse the same page
  component.
- After login, redirect to `/users/:username` for the current user unless a
  pending return URL exists.
- `/users/:username` is the user trip overview. It combines a small amount of
  user information with that user's readable trips, using public or
  viewer-specific permissions.
- `/trips/:tripId` is the trip detail page. If opened through a share link,
  preserve the share token in the URL and include it on related API requests.
- `/admin` is for admin-only workflows and is available only to logged-in users
  with the `ADMIN` role.
- `/setup` is for first-time setup. It does not need to be linked from normal
  navigation.

## Header

- The header should remain compact on all screen sizes.
- When logged out, show the login-oriented actions needed for `/`.
- When logged in, show the current user's profile control in the top right. It
  should be a dropdown-style user menu with the user's display name or username
  and, when available, an avatar or initials.
- The user menu should include navigation to the user's trip overview at
  `/users/:username`, account actions such as settings and logout when those
  exist, and `/admin` only when the current user has the `ADMIN` role.
- Keep the top bar consistent across authenticated pages, including the user
  trip overview, trip detail page, and admin page.

## Landing And Login Page

- The login page should be only a login form centered in the viewport with a
  modern, calm visual treatment.
- Do not carry over the current landing page composition, card pairings, or
  copy-heavy intro style.
- The page may use updated theme colors if that makes the app feel more modern,
  but color changes should remain token-driven and should not create one-off
  styling inside the page.
- The form should have clear hierarchy: title, concise helper text if needed,
  email or username field, password field, submit button, validation, and loading
  state.
- Keep the form container responsive: comfortably narrow on desktop, nearly
  full-width on mobile, and vertically centered without clipping on short
  screens.
- On mobile, the login form should be easy to complete with one thumb: large
  fields, clear validation, and no side-by-side form controls.

## User Trip Overview

- `/users/:username` is the only trip overview page. For the current logged-in
  user it acts as "my trips"; for another user it shows that user's readable
  public or viewer-permitted trips.
- The page should include a compact user summary above or beside the trips list:
  avatar or initials, display name, username, and short supporting details such
  as bio, home base, or trip counts when available.
- User information should add context without turning the page into a large
  profile landing page. The trips list remains the primary content.
- The trips list should be simple, with enough visual detail to identify and
  scan trips quickly.
- Each trip item should show the trip cover image, trip name, key dates or
  timeframe, and a compact status treatment.
- Upcoming trips should have a badge. When the start date is known, include the
  number of days until departure, for example `Upcoming: 12 days`.
- Past or active trips should still have a visible but quieter status so users
  can distinguish upcoming, active, and completed trips without reading dates.
- Use a reusable `TripCard` or `TripListItem` component and a reusable
  `TripStatusBadge` component. The status badge is a good candidate for `cva`.
- Use a reusable `UserSummary` component for the profile information so the same
  page can handle the owner, another authenticated viewer, and unauthenticated
  visitors consistently.
- The frontend should not infer hidden trips. If the API does not return a trip,
  it should not appear.
- When viewing your own page, expose trip creation actions on this page.
- Trip creation should support the expected basics first: trip name, media
  upload, and any required initial metadata.
- When viewing another user's page or while unauthenticated, show only readable
  content and hide owner-only creation or management actions.
- The authenticated top bar with the current user dropdown should be present
  when a viewer is logged in.
- Empty, loading, and error states should be explicit and compact. Empty states
  may include trip creation only for users allowed to create trips.

## Trip Page

- Desktop layout: content on the left, map on the right. The content side shows
  either the plan or the travel posts depending on the selected mode.
- Use a clear two-option toggle between `Plan` and `Travel`. A segmented control
  is preferred and is a good candidate for `cva`.
- `Plan` mode shows the current itinerary and actions for adding or editing
  stops.
- The visible itinerary list should show only planned or upcoming stops. Do not
  display itinerary items for places that have already been visited.
- New itinerary stops must be added through modal dialogs. Do not place a raw
  stop creation form directly on the trip page.
- `Travel` mode shows posts and an action to add more posts.
- New posts should also be created through a modal or dedicated focused flow,
  not an always-visible form embedded in the page.
- Users who are not trip members must not see the plan side panel, plan list, or
  plan editing actions.
- Non-members may still see planned itinerary locations on the map when the trip
  visibility/share permissions allow it. In that case, show the plan spatially
  on the map without exposing the side-panel itinerary details.
- The right side map should show upcoming itinerary items and post locations
  together. Use visually distinct markers or marker states so planned stops and
  published posts are not confused.
- Upcoming itinerary markers should be emphasized enough to support travel-day
  use, but they should not overpower post markers.
- Share-link trip URLs should carry the share token in the URL, for example as
  a query parameter on `/trips/:tripId`.
- When a trip page has a share token, include it as `X-Trip-Share-Token` on
  trip-related API requests so unauthenticated or non-member viewers do not hit
  avoidable authorization errors.
- Browser-loaded media/content URLs cannot send custom headers. When rendering
  content for a share-link trip, append the token as `?share_token=...` or
  `&share_token=...` so images, videos, and other content URLs can load without
  authorization errors.
- The map should plot GPS tracker data, post locations, and itinerary items
  together so the route and story can be understood spatially.
- Plan items and posts should remain scannable while the map stays visible on
  larger screens.
- Mobile layout may stack content or use tabs/segmented controls between posts
  and map, but both views must remain easy to reach.
- The map should have clear empty, loading, and missing-location states.
- Keep trip detail subcomponents small. Expected reusable pieces include
  `TripModeToggle`, `ItineraryStopList`, `ItineraryStopItem`, `PostList`,
  `PostListItem`, `TripMap`, `TripMapMarker`, `AddStopModal`, and
  `AddPostModal`.

## Admin Page

- `/admin` should be clearly separated from normal user and trip browsing.
- Require an authenticated current user with role `ADMIN`.
- Show only admin actions the logged-in user is allowed to perform.
- Prefer dense, task-focused controls over decorative layouts.

## First-Time Setup Page

- `/setup` is a direct-access page for initial app configuration.
- It does not need to appear in the header or other normal navigation.
- Keep the flow focused on required setup tasks only.
