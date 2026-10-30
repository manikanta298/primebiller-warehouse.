FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Coolify may inject NODE_ENV=production/omit=dev during build. The compiler
# and tsx migration runner are required even when building a production image.
RUN npm ci --include=dev --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY assets ./assets
RUN npm run build
ENV NODE_ENV=production PORT=4000
USER node
EXPOSE 4000
CMD ["/bin/sh", "-c", "npm run db:migrate && exec npm start"]
