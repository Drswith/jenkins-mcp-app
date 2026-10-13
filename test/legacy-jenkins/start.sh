#!/bin/sh
set -eu
home=${JENKINS_HOME:-/var/jenkins_home}
bootstrap=/opt/jenkins-legacy-bootstrap
desired="${JENKINS_VERSION}:$(cat "$bootstrap/plugins-downloads.tsv" "$bootstrap/permissions-plugins.tsv" | sha256sum | cut -d ' ' -f 1)"
marker="$home/.legacy-plugin-set"
mkdir -p "$home/plugins" "$home/init.groovy.d"
if [ "$(cat "$marker" 2>/dev/null || true)" != "$desired" ]; then
  for lockfile in "$bootstrap/plugins-downloads.tsv" "$bootstrap/permissions-plugins.tsv"; do
  while read -r name version digest url; do
    [ -n "$name" ] || continue
    case "$name" in \#*) continue ;; esac
    file="$home/plugins/$name.jpi"
    if [ ! -s "$file" ] || [ "$(sha256sum "$file" | cut -d ' ' -f 1)" != "$digest" ]; then
      curl -fL --retry 3 --connect-timeout 15 --max-time 180 "$url" -o "$file.tmp"
      printf '%s  %s\n' "$digest" "$file.tmp" | sha256sum -c -
      mv "$file.tmp" "$file"
    fi
    touch "$file.pinned"
  done < "$lockfile"
  done
  printf '%s\n' "$desired" > "$marker.tmp"
  mv "$marker.tmp" "$marker"
fi
cp "$bootstrap/init.groovy" "$home/init.groovy.d/legacy-test.groovy"
exec /usr/local/bin/jenkins.sh "$@"
