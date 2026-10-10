# Built from the repository root: the connector bundles the app's record format.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm connector:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/connector/dist/connector.js ./connector.js
USER node
EXPOSE 3000
CMD ["node", "connector.js"]
