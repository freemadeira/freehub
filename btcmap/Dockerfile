# Built from the repository root: the sync bundles the app's record helpers.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm btcmap:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/btcmap/dist/btcmap.js ./btcmap.js
USER node
CMD ["node", "btcmap.js"]
