FROM node:20-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS development

COPY . .
RUN npx prisma generate

EXPOSE 4000

CMD ["npm", "run", "dev"]

FROM base AS build

COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 4000

CMD ["node", "dist/index.js"]
