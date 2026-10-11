FROM node:24-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@11.28.5

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

ARG BACKEND_URL
ARG WALLET_ORIGIN
ARG WALLET_RP_ID
ARG BASE_SEPOLIA_RPC_URL
ARG BUNDLER_URL=""
ENV BACKEND_URL=${BACKEND_URL} \
    WALLET_ORIGIN=${WALLET_ORIGIN} \
    WALLET_RP_ID=${WALLET_RP_ID} \
    BASE_SEPOLIA_RPC_URL=${BASE_SEPOLIA_RPC_URL} \
    BUNDLER_URL=${BUNDLER_URL}

RUN test -n "$BACKEND_URL" && test -n "$WALLET_ORIGIN" \
    && test -n "$WALLET_RP_ID" && test -n "$BASE_SEPOLIA_RPC_URL" \
    && pnpm check && pnpm build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
