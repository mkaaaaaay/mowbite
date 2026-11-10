# input: a json-rpc answer as mower_rpc picks it out, whatever its layout (pretty printed over lines or all on one):
# logs.recent's result [{t, level, node, msg}] or planner.log's {lines: [{t, level, msg}]}. every entry, an object with
# t and level, goes to the file of its day (utc) in DIR, a line each: with ROS=1 "<unix time> <LEVEL> <node>: <message>",
# otherwise (the planner's) "<unix time> <LEVEL> <message as in json, \n for a line break>". prints the newest t
#
# json strings never span lines: with the escaped backslashes and quotes out of the way (\001, \002) every " left starts
# or ends one. split there, the odd parts of a line lie between strings, the even ones are strings

# s with every c as to
function swap(s, c, to,    a, n, i, r) {
  n = split(s, a, c)
  r = a[1]
  for (i = 2; i <= n; i++) r = r to a[i]
  return r
}
# a string as in json, and as text: quotes and backslashes plain, line breaks and tabs a space
function json(s) { return swap(swap(s, "\001", "\\\\"), "\002", "\\\"") }
function text(s) {
  gsub(/\\[nt]/, " ", s)
  return swap(swap(s, "\001", "\\"), "\002", "\"")
}
function entry(    t, out) {
  t = v["t"]
  if (t !~ /^[0-9.]+$/ || v["level"] == "") return
  if (ENVIRON["ROS"] == 1) out = t " " text(v["level"]) " " text(v["node"]) ": " text(v["msg"])
  else out = t " " json(v["level"]) " " json(v["msg"])
  print out >> (ENVIRON["DIR"] "/" strftime("%Y%m%d", int(t)) ".log")
  if (max == "" || t + 0 > max + 0) max = t
}
# between strings: a colon makes the string before it a key, a number (true, false, null) right after it is the value,
# then where objects start and end, in order. an entry ends with its }
function between(s) {
  sub(/^[ \t\r]+/, "", s)
  if (s == "") return
  if (cand && s ~ /^:/) {
    key = last
    want = 1
    s = substr(s, 2)
    sub(/^[ \t\r]+/, "", s)
  }
  cand = 0
  if (s == "") return
  if (want && match(s, /^[-+.0-9a-zA-Z]+/)) v[key] = substr(s, 1, RLENGTH)
  want = 0
  while (match(s, /[{}]/)) {
    if (substr(s, RSTART, 1) == "}") entry()
    split("", v)
    s = substr(s, RSTART + 1)
  }
}

{
  s = $0
  gsub(/\\\\/, "\001", s)
  gsub(/\\"/, "\002", s)
  n = split(s, p, "\"")
  for (i = 1; i <= n; i++) {
    if (i % 2) between(p[i])
    else if (want) {
      v[key] = p[i]
      want = 0
    } else {
      last = p[i]
      cand = 1
    }
  }
}

END { if (max != "") print max }
