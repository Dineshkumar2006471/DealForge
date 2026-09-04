FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY . .

USER node

EXPOSE 8080

CMD ["node", "src/index.js"]
