# Node 22+ is required for built-in node:sqlite (DatabaseSync) and native TypeScript execution
FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/server ./server
COPY --from=build /app/flutter_app ./flutter_app
COPY --from=build /app/HAMILHA_ANDROID_IOS.zip ./HAMILHA_ANDROID_IOS.zip

RUN mkdir -p /app/data/downloads && chown -R node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "server.ts"]
