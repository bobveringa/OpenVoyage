# OpenVoyage
OpenVoyage is an open-source travel planning and blogging platform, with the 
goal of making it easy to plan trips, and share travel experiences with friends
and family.

The name "OpenVoyage" comes from the name my girlfriend gave the project when
I initially started working on it "BobVoyage" (Get it, it's like the French 
"Bon Voyage", but with my name, instead of bon) she is very funny. But having my
name in the project weirded me out, so I changed it to OpenVoyage, 
which is more fitting for an open-source project.

## 🚀 Quick Start
The quickest way to get OpenVoyage up and running is to use Docker Compose.

```bash
cp .env.example .env
docker compose up -d
```

That pulls the latest released image from
`ghcr.io/bobveringa/openvoyage`. Set `OPENVOYAGE_IMAGE` in `.env` to pin a
version instead, and `docker compose pull && docker compose up -d` to upgrade.
To run your own build, `docker build --tag openvoyage:local .` and point
`OPENVOYAGE_IMAGE` at it.

Before the first start, fill in `SECRET_KEY` and `POSTGRES_PASSWORD` in `.env`.
`SECRET_KEY` has no default and the application will not start without it, so
generate a unique value:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep it stable afterwards. Every access, refresh, and media token is signed
with it, so changing it signs everyone out, and a different value per worker
produces sporadic 401s. The same applies to `APP_SETTINGS_ENCRYPTION_KEY`,
which is optional until you save a secret setting (such as a routing API key)
in the admin interface.

Deployments refuse to start on a placeholder or example secret. Set
`ENVIRONMENT=local` in `.env` to downgrade those checks to warnings while
working on a throwaway local checkout.

Open `http://localhost:8000`. This starts a PostgreSQL container and one
OpenVoyage application container. The application container contains both the
compiled frontend and FastAPI backend; it applies database migrations before it
starts.

Persistent uploads are stored in `./data/media`, and PostgreSQL data is kept in
the `postgres_data` Docker volume.


## 📂 Project Structure
The project is organized into the following directories:
- `backend/` - The backend API built with Python and FastAPI.
- `frontend/` - The frontend application built with React.

Each directory contains its own README with setup instructions and development 
guidelines.

## Continuous integration

`.github/workflows/ci.yml` holds the checks: frontend lint/build/unit tests,
the complete backend Pytest suite, Playwright browser tests against an isolated
PostgreSQL database, and a production container build. Pull requests run it
directly. `release.yml` calls the same workflow for pushes to `main` and for
release tags, so the checks are defined once and a publish only happens after
they pass.

The browser job creates its own disposable administrator and small place-data
fixture. Its committed `E2E_LOGIN_EMAIL` and `E2E_LOGIN_PASSWORD` values are
deliberately non-secret because they can only access the job's temporary API
and database. Local or deployed-instance credentials remain in the gitignored
root `.env` file and must never be copied into a workflow.

### Releases

Images are published to `ghcr.io/bobveringa/openvoyage` with the repository's
own `GITHUB_TOKEN`; no registry secrets are configured or needed.

| Trigger | Image tags | Android APK |
| --- | --- | --- |
| Push to `main` | `edge`, `main`, `sha-<short>` | no |
| Tag `v1.2.3` | `1.2.3`, `1.2`, `latest` | yes |
| Tag `v1.2.3-rc1` | `1.2.3-rc1` | yes |
| Manual dispatch | `<branch name>` | yes |

Prerelease tags are anything with a hyphen in them (`-rc1`, `-beta.2`). They
publish an installable image but deliberately do not move `latest` or the
`1.2` alias, so a release candidate can be tested without any deployment that
tracks `latest` picking it up.

Cutting a release is therefore just a tag:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

The Android APK is attached to the workflow run as an artifact (30-day
retention), not to a GitHub Release. It is debug-signed, because
`frontend/android/app/build.gradle` has no release signing config yet — it
installs on a device, but it is not store-publishable.

## Frontend
The frontend is a Vite React app written in TypeScript with Tailwind CSS and a
shadcn/ui-style shared component structure.

```bash
cd frontend
npm install
npm start
```

By default the development server proxies `/api` to `http://127.0.0.1:8000`,
so the frontend continues to use same-origin API URLs. Set
`VITE_API_PROXY_TARGET` to point the proxy at another local backend. Set
`VITE_API_BASE_URL` only when intentionally serving the frontend separately
from its API; it is embedded at build time.

Generate the frontend API schema and TypeScript definitions from the FastAPI
OpenAPI spec:

```bash
npm run api:generate
```

The generated files live in `frontend/src/api/`. The typed client is exported
from `frontend/src/api/client.ts`, shared UI components live under
`frontend/src/components/`, and all theme color tokens live in
`frontend/src/styles/theme.css`.

## 🤖 Use of AI
This project was developed with the assistance of AI tools, which helped with
code generation, debugging, and documentation. However, all code was reviewed 
and tested by humans to ensure quality.

The usage of AI tools for contributions to this project is allowed. However, 
PR's that add hundreds of lines of code without collaboration, discussion or 
explanation will be rejected without review, regardless of the quality of the 
code, or whether it was generated by AI or not.


## 📜 License
OpenVoyage is licensed under the GNU AFFERO GENERAL PUBLIC LICENSE v3.0. 
See [LICENSE](LICENSE.md) for more details.
