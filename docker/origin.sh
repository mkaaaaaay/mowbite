# who may use MowBite's scripts from a browser, sourced by every cgi: MowBite itself (its page here, on another mower or
# on a computer at home, the app on a phone), programs without a browser (Home Assistant, the mower's own scripts) and
# the addresses in MOWBITE_ORIGINS. a page from anywhere else gets nothing to read and can't change anything

# the browser's Origin: none (a program, or the page itself asking), this page, the app, the home network or one listed
from_mowbite() {
  o=${HTTP_ORIGIN:-}
  case $o in
  "" | "http://$HTTP_HOST" | "https://$HTTP_HOST" | capacitor://localhost) return 0 ;;
  *[!][A-Za-z0-9.:/-]*) return 1 ;;
  http://* | https://*) ;;
  *) return 1 ;;
  esac
  if [ -n "${MOWBITE_ORIGINS:-}" ]; then
    old=$IFS
    IFS=,
    set -f
    for x in $MOWBITE_ORIGINS; do [ "$o" = "${x%/}" ] && IFS=$old && set +f && return 0; done
    IFS=$old
    set +f
  fi
  # the home network, by the page's host without its port: localhost, private addresses (tailscale's too), names
  # without a dot or with a home network's ending
  h=${o#*://}
  case $h in
  \[*) h=${h#\[} && h=${h%%]*} ;;
  *) h=${h%%:*} ;;
  esac
  case $h in
  '' | *[!0-9.]*) ;;
  127.* | 10.* | 192.168.* | 169.254.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
  100.6[4-9].* | 100.[7-9][0-9].* | 100.1[01][0-9].* | 100.12[0-7].*) return 0 ;;
  *) return 1 ;;
  esac
  case $h in
  localhost | ::1 | [fF][cCdD]*:* | [fF][eE][89aAbB]*:*) return 0 ;;
  *.local | *.lan | *.home | *.home.arpa | *.internal | *.localdomain | *.fritz.box) return 0 ;;
  '' | *.* | *:*) return 1 ;;
  esac
  return 0
}

# the header that hands the answer over to MowBite's page on another origin (the app, another mower's page)
cors() { [ -n "${HTTP_ORIGIN:-}" ] && from_mowbite && printf 'Access-Control-Allow-Origin: %s\r\nVary: Origin\r\n' "$HTTP_ORIGIN"; }

# any other page is turned away before anything happens
if ! from_mowbite; then
  printf 'Status: 403 Forbidden\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\n\r\nnot from MowBite\n'
  exit 0
fi
