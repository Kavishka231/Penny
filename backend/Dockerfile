FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY frontend/ ./public/

EXPOSE 3000
USER node
CMD ["npm", "start"]
