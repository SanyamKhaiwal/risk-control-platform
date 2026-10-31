# syntax=docker/dockerfile:1.7
# The React dashboard, built with Node and served by an unprivileged nginx. Build from the repo root:
#   docker build -f deploy/docker/dashboard.Dockerfile .

FROM node:26.12.1-alpine3.24 AS build
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY dashboard/ ./
# The browser calls the gateway at this address; it is baked into the bundle at build time.
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24
# Pick up Alpine security fixes released after the base image was built (Trivy found brotli and curl),
# and drop curl: nginx doesn't need it and the health check uses busybox wget.
USER root
RUN apk upgrade --no-cache && apk del --no-cache curl
# The base image's unprivileged nginx user, stated so scanners and readers don't have to know it.
USER 101
# The image runs envsubst over templates at start-up, filling in API_ORIGIN for the CSP.
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
