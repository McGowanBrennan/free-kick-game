# The game and its server in one image (for Fly.io, Railway or anywhere that runs containers).
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY harness/package.json harness/
COPY server/package.json server/
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm run server:build
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
