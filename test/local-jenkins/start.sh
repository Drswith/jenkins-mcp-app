#!/bin/sh
set -eu

home=${JENKINS_HOME:-/var/jenkins_home}
bootstrap=/opt/jenkins-bootstrap
marker="$home/.codex-plugin-set"
desired="${JENKINS_VERSION:-unknown}:$(sha256sum "$bootstrap/plugins.txt" | cut -d ' ' -f 1)"
installed=$(cat "$marker" 2>/dev/null || true)

mkdir -p "$home/plugins" "$home/init.groovy.d"
if [ "$installed" != "$desired" ] || [ ! -s "$home/plugins/mcp-server.jpi" ] || [ ! -s "$home/plugins/git.jpi" ]; then
  jenkins-plugin-cli --plugin-file "$bootstrap/plugins.txt" \
    --plugin-download-directory "$home/plugins" --latest false
  printf '%s\n' "$desired" > "$marker.tmp"
  mv "$marker.tmp" "$marker"
fi
cp "$bootstrap/init.groovy" "$home/init.groovy.d/local-test.groovy"
exec /usr/local/bin/jenkins.sh "$@"
