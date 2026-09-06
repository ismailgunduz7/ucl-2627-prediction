# The API runs as a long-lived process, not a serverless function: it polls the
# score provider on a schedule and sweeps spent refresh tokens daily, and both
# of those need something that stays awake between requests.
#
# Built from the repository root because the server is an npm workspace and the
# lockfile that pins it lives there.

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a dependency install is only redone when they change.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY server ./server
RUN npm run build --workspace server

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist

WORKDIR /app/server
EXPOSE 8787
CMD ["node", "dist/index.js"]
