FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY vault.js server.js ./
COPY public ./public
ENV VAULT_DIR=/app/data
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
