# Build the browser application first so the runtime image only contains its
# static output and the Python API.
FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim

WORKDIR /app/backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend/app \
    FRONTEND_DIST_DIRECTORY=/app/frontend-dist

RUN apt-get update \
    && apt-get install --no-install-recommends --yes curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /build/frontend/dist /app/frontend-dist
COPY docker/entrypoint.sh /usr/local/bin/openvoyage-entrypoint
RUN chmod +x /usr/local/bin/openvoyage-entrypoint

EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/openvoyage-entrypoint"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
