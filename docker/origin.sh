# who may use MowBite's scripts from a browser, sourced by every cgi: MowBite itself (its page here, on another mower or
# on a computer at home, the app on a phone), programs without a browser (Home Assistant, the mower's own scripts) and
# the addresses in MOWBITE_ORIGINS. a page from anywhere else gets nothing to read and can't change anything

# a host[:port] without its port, an ipv6 address without its brackets
bare() {
  case $1 in
  \[*) _b=${1#\[} && echo "${_b%%]*}" ;;
  *) echo "${1%%:*}" ;;
  esac
}

# a host of the home network ($1, its port may come with it): localhost, private addresses (tailscale's too), names
# without a dot or with a home network's ending
home_host() {
  _h=$(bare "$1")
  case $_h in
  '' | *[!0-9.]*) ;;
  127.* | 10.* | 192.168.* | 169.254.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
  100.6[4-9].* | 100.[7-9][0-9].* | 100.1[01][0-9].* | 100.12[0-7].*) return 0 ;;
  *) return 1 ;;
  esac
  case $_h in
  localhost | ::1 | [fF][cCdD]*:* | [fF][eE][89aAbB]*:*) return 0 ;;
  *.local | *.lan | *.home | *.home.arpa | *.internal | *.localdomain | *.fritz.box) return 0 ;;
  '' | *.* | *:*) return 1 ;;
  esac
  return 0
}

# MOWBITE_ORIGINS lists the origin $1, or with host: one with the host of $1 (ports left out)
listed() {
  [ -n "${MOWBITE_ORIGINS:-}" ] || return 1
  _old=$IFS
  # (a space after the comma too)
  IFS=', '
  set -f
  _r=1
  for _x in $MOWBITE_ORIGINS; do
    _x=${_x%/}
    if [ "${2:-}" = host ]; then [ "$(bare "${_x#*://}")" = "$(bare "$1")" ] && _r=0; else [ "$1" = "$_x" ] && _r=0; fi
  done
  IFS=$_old
  set +f
  return $_r
}

# asked at a host of the home network or one listed (a name from the internet bound to this mower's address, dns
# rebinding, isn't), and the browser's Origin: none (a program, or the page itself asking), this page, the app, the
# home network or one listed
from_mowbite() {
  [ -z "${HTTP_HOST:-}" ] || home_host "$HTTP_HOST" || listed "$HTTP_HOST" host || return 1
  _o=${HTTP_ORIGIN:-}
  case $_o in
  "" | "http://$HTTP_HOST" | "https://$HTTP_HOST" | capacitor://localhost) return 0 ;;
  *[!][A-Za-z0-9.:/-]*) return 1 ;;
  http://* | https://*) ;;
  *) return 1 ;;
  esac
  listed "$_o" || home_host "${_o#*://}"
}

# the header that hands the answer over to MowBite's page on another origin (the app, another mower's page)
cors() { [ -n "${HTTP_ORIGIN:-}" ] && from_mowbite && printf 'Access-Control-Allow-Origin: %s\r\nVary: Origin\r\n' "$HTTP_ORIGIN"; }

# a request turned down, with why. the Status line first: busybox httpd only reads it there
fail() { printf 'Status: %s\r\n' "$1"; cors; printf 'Content-Type: text/plain\r\n\r\n%s\n' "$2"; exit 0; }

# the posted lines of shape $3 saved as file $1, a body of more than $2 bytes is turned down
save_lines() {
  len=${CONTENT_LENGTH:-0}
  if [ "$len" -le 0 ] || [ "$len" -gt "$2" ]; then fail 413 'too large'; fi
  # a file of its own: two saves at once mustn't write into the same one
  T="$1.$$"
  # a connection that broke off hands over less than it said
  head -c "$len" > "$T" && [ "$(wc -c < "$T")" -eq "$len" ] || { rm -f "$T"; fail 400 'incomplete'; }
  # (cat notices a full disk, grep doesn't)
  tr -d '\r' < "$T" | grep -E "$3" | cat > "$T.ok" && mv "$T.ok" "$1" || { rm -f "$T" "$T.ok"; fail 500 'not saved'; }
  rm -f "$T"
}

# any other page is turned away before anything happens
if ! from_mowbite; then
  printf 'Status: 403 Forbidden\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\n\r\nnot from MowBite\n'
  exit 0
fi
