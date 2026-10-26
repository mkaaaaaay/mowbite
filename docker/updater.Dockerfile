# MowBite's updater (docker/updater.sh): the docker cli with compose, a tiny http server for the app, the scripts

# busybox's httpd, unpacked for the target arch without running anything of it, so the image builds for the mower anywhere
FROM --platform=$BUILDPLATFORM alpine:3.24 AS httpd
ARG TARGETARCH
RUN arch=$([ "$TARGETARCH" = arm64 ] && echo aarch64 || echo x86_64) && \
    apk add -q --root /x --arch "$arch" --initdb --no-scripts --no-cache \
      --keys-dir "/usr/share/apk/keys/$arch" --repositories-file /etc/apk/repositories busybox-extras

FROM docker:29.9.2-cli
# (a busybox runs the applet its name says)
COPY --from=httpd /x/bin/busybox-extras /usr/sbin/httpd
COPY docker/updater-lib.sh /updater-lib.sh
COPY --chmod=755 docker/updater.sh /updater.sh
COPY --chmod=755 docker/updater-self.sh /updater-self.sh
COPY --chmod=755 docker/updater.cgi /www/cgi-bin/updater
ENTRYPOINT ["/updater.sh"]
