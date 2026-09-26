# the app is plain static files, so it's built natively and only copied into the target arch image
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir /empty

FROM busybox:1.37-musl
COPY --from=build --chown=1000:1000 /app/out /www
COPY --chmod=755 docker/settings.cgi /www/cgi-bin/settings
COPY docker/entrypoint.sh /entrypoint.sh
# empty, writable settings dir. no RUN in this stage, so building for arm on a pc needs no emulation
COPY --from=build --chown=1000:1000 /empty /data
VOLUME /data
USER 1000
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
