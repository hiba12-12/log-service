# ===== Stage 1: Build =====
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ===== Stage 2: Production =====
FROM node:22-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

EXPOSE 8080

CMD ["npm", "run", "start"]