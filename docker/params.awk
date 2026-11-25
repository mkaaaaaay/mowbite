# the lines of the mower's settings kept by the app that are in its list (params.list: name, int|double|bool, lowest,
# highest), and "enabled 0|1". awk -f params.awk params.list <lines>: params.cgi on a save, params.sh before setting them
FNR == NR {
  if (NF && $1 !~ /^#/) { type[$1] = $2; lo[$1] = $3; hi[$1] = $4 }
  next
}
/^enabled [01]$/ { print; next }
NF == 2 && index($1, "/mower_logic/") == 1 {
  k = substr($1, 14)
  if (!(k in type)) next
  if (type[k] == "bool") { if ($2 == "true" || $2 == "false") print; next }
  if ($2 !~ /^-?[0-9]+(\.[0-9]+)?$/ || length($2) > 14 || (type[k] == "int" && index($2, "."))) next
  if ($2 + 0 >= lo[k] + 0 && $2 + 0 <= hi[k] + 0) print
}
