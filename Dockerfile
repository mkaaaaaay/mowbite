# the app is plain static files, so it's built natively and only copied into the target arch image
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
# 1 in the dev image: the schedule can be set up there, the release only shows it for now
ARG SCHEDULE_EDIT
ENV NEXT_PUBLIC_SCHEDULE_EDIT=$SCHEDULE_EDIT
# e.g. dev.42 in the dev image, shown after the version in the settings
ARG VERSION_SUFFIX
ENV VERSION_SUFFIX=$VERSION_SUFFIX
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir /empty

# mqtt client for the recorder and scheduler, unpacked for the target arch without running anything of it
FROM --platform=$BUILDPLATFORM alpine:3.22 AS mqtt
ARG TARGETARCH
RUN arch=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    apk add -q --root /mq --arch "$arch" --initdb --no-scripts --no-cache \
      --keys-dir "/usr/share/apk/keys/$arch" --repositories-file /etc/apk/repositories mosquitto-clients

FROM busybox:1.37-musl
ARG SCHEDULE_EDIT
ENV MOWBITE_SCHEDULER=${SCHEDULE_EDIT:+on}
COPY --from=mqtt /mq/lib /lib
COPY --from=mqtt /mq/usr/lib /usr/lib
COPY --from=mqtt /mq/usr/bin/mosquitto_sub /mq/usr/bin/mosquitto_pub /usr/bin/
COPY --from=build --chown=1000:1000 /app/out /www
COPY --chmod=755 docker/settings.cgi /www/cgi-bin/settings
COPY --chmod=755 docker/sensors.cgi /www/cgi-bin/sensors
COPY --chmod=755 docker/backups.cgi /www/cgi-bin/backups
COPY --chmod=755 docker/recorder.sh docker/scheduler.sh /
COPY --chmod=755 docker/schedule.cgi /www/cgi-bin/schedule
COPY --chmod=755 docker/roslog.cgi /www/cgi-bin/roslog
COPY docker/broker.sh /broker.sh
COPY docker/recorder.awk /recorder.awk
COPY docker/httpd.conf /etc/httpd.conf
COPY docker/entrypoint.sh /entrypoint.sh
# empty, writable settings dir. no RUN in this stage, so building for arm on a pc needs no emulation
COPY --from=build --chown=1000:1000 /empty /data
VOLUME /data
USER 1000
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
