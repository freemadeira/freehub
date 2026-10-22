# Built from the repository root: the reader bundles the app's catalog format.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm reader:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/reader/dist/reader.js ./reader.js
USER node
EXPOSE 3000
CMD ["node", "reader.js"]
