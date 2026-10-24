# MowBite's updater (docker/updater.sh): the docker cli with compose, and the script
FROM docker:29.9.2-cli
COPY --chmod=755 docker/updater.sh /updater.sh
ENTRYPOINT ["/updater.sh"]
