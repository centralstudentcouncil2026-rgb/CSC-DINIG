FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
