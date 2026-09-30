FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/app/data/number-zero.sqlite
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY server.js app.js economy.js badges.js experience.js multiplayer.js config.js ./
COPY index.html styles.css experience.css multiplayer.css ./
COPY backend ./backend
COPY assets ./assets
COPY fonts ./fonts
USER node
EXPOSE 8080
CMD ["node", "server.js"]
