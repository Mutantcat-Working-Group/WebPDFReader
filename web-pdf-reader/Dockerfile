# Web PDF reader image: builds the Vite app and serves it with nginx.
FROM node:22-alpine AS build

ARG VERSION=1.0.20260920

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

ARG VERSION=1.0.20260920

COPY --from=build /app/dist /usr/share/nginx/html

LABEL org.opencontainers.image.version="${VERSION}"

EXPOSE 80
