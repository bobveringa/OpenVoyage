# OpenVoyage Frontend

React, TypeScript, Vite, Tailwind CSS, and shadcn/ui-style shared components.

## Commands

```bash
npm install
npm run dev
```

Generate the API schema and TypeScript definitions from the FastAPI app:

```bash
npm run api:generate
```

Run checks before committing frontend changes:

```bash
npm run check
```

## Structure

- `src/styles/theme.css` is the single theme token file for color, radius, and shadows.
- `src/components/ui/` contains shared shadcn/ui-style primitives.
- `src/components/layout/` contains shared page/layout components.
- `src/api/openapi.json` and `src/api/types.ts` are generated.
- `src/api/client.ts` exports the typed OpenAPI fetch client.

The API generation script uses `PYTHON` when set, otherwise `../.venv`,
otherwise the system Python command.
