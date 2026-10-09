# Build the existing React/TanStack Start frontend without altering its screens.
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
# Force Nitro's Node adapter rather than the Lovable Cloudflare default.
ENV NITRO_PRESET=node-server
RUN bun run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
