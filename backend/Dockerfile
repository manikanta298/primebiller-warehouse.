FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
RUN npm run build
ENV NODE_ENV=production PORT=4000
USER node
EXPOSE 4000
CMD ["npm", "start"]
