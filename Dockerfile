FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn workspace @fillx/shared build && yarn workspace @fillx/server build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/package.json .
COPY --from=builder /app/shared/package.json shared/
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/server/package.json server/
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/node_modules node_modules
EXPOSE 8000
CMD ["node", "server/dist/index.js"]
