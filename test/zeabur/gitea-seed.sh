#!/bin/sh
set -eu
umask 077

data=/var/lib/gitea
access="$data/local-test-credentials.json"
if [ ! -f "$access" ]; then
  password=$(head -c 24 /dev/urandom | base64 | tr -d '\n')
  gitea --config /etc/gitea/app.ini admin user create \
    --username codex-test --password "$password" --email codex-test@example.invalid \
    --admin --must-change-password=false
  printf '{"user":"codex-test","password":"%s"}\n' "$password" > "$access"
fi
password=$(sed -n 's/.*"password":"\([^"]*\)".*/\1/p' "$access")
url=http://127.0.0.1:3000/codex-test/sample.git
if ! curl -fsS http://127.0.0.1:3000/api/v1/repos/codex-test/sample >/dev/null; then
  curl -fsS -u "codex-test:$password" -H 'Content-Type: application/json' \
    -d '{"name":"sample","private":false,"auto_init":false,"default_branch":"master","description":"Disposable Jenkins SCM test data"}' \
    http://127.0.0.1:3000/api/v1/user/repos >/dev/null
fi
if [ ! -d "$data/test-seed/.git" ]; then
  git clone "$url" "$data/test-seed"
  git -C "$data/test-seed" config user.name "Jenkins Test"
  git -C "$data/test-seed" config user.email "jenkins-test@example.invalid"
fi
cd "$data/test-seed"
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git checkout -b master
  printf 'Jenkins SCM test repository\n' > README.md
  git add README.md
  git commit -m 'Initial test commit'
fi
if [ "${1:-}" = "--commit" ]; then
  printf 'SCM live test\n' >> README.md
  git add README.md
  git commit -m 'Exercise Jenkins change set'
fi
authorization=$(printf 'codex-test:%s' "$password" | base64 | tr -d '\n')
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader \
  GIT_CONFIG_VALUE_0="Authorization: Basic $authorization" git push -u origin master
echo 'Gitea sample repository ready.'
