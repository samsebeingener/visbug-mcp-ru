FROM node:22-alpine

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

# Port WebSocket — doit correspondre à WS_PORT dans src/server.js
EXPOSE 4844

CMD ["node", "src/server.js"]
