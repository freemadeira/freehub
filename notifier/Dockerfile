# Built from the repository root: the notifier bundles the app's notification rules.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm notifier:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/notifier/dist/notifier.js ./notifier.js
# Sent notifications are remembered here; mount a volume so restarts don't repeat them.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "notifier.js"]
