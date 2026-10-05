FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
