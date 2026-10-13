FROM alpine:3.22

RUN apk add --no-cache git git-daemon \
    && git init --bare /srv/git/sample.git \
    && git init -b master /seed \
    && git -C /seed config user.name "Jenkins Test" \
    && git -C /seed config user.email "jenkins-test@example.invalid" \
    && printf 'Local Jenkins SCM fixture\n' > /seed/README.md \
    && git -C /seed add README.md \
    && git -C /seed commit -m "Initial test commit" \
    && git -C /seed remote add origin /srv/git/sample.git \
    && git -C /seed push -u origin master

EXPOSE 9418
CMD ["git", "daemon", "--reuseaddr", "--base-path=/srv/git", "--export-all", "--verbose", "/srv/git"]
