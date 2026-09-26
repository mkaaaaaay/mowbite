# the app is plain static files, so it's built natively and only copied into the target arch image
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir /empty

# mqtt client for the sensor recorder, unpacked for the target arch without running anything of it
FROM --platform=$BUILDPLATFORM alpine:3.22 AS mqtt
ARG TARGETARCH
RUN arch=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    apk add -q --root /mq --arch "$arch" --initdb --no-scripts --no-cache \
      --keys-dir "/usr/share/apk/keys/$arch" --repositories-file /etc/apk/repositories mosquitto-clients

FROM busybox:1.37-musl
COPY --from=mqtt /mq/lib /lib
COPY --from=mqtt /mq/usr/lib /usr/lib
COPY --from=mqtt /mq/usr/bin/mosquitto_sub /usr/bin/mosquitto_sub
COPY --from=build --chown=1000:1000 /app/out /www
COPY --chmod=755 docker/settings.cgi /www/cgi-bin/settings
COPY --chmod=755 docker/sensors.cgi /www/cgi-bin/sensors
COPY --chmod=755 docker/recorder.sh /recorder.sh
COPY docker/recorder.awk /recorder.awk
COPY docker/entrypoint.sh /entrypoint.sh
# empty, writable settings dir. no RUN in this stage, so building for arm on a pc needs no emulation
COPY --from=build --chown=1000:1000 /empty /data
VOLUME /data
USER 1000
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
