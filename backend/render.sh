#!/bin/bash
# Substitutes the secrets from .companion_key and .hmac_key into
# docker-compose.yml, in place. docker-compose.yml is the template with
# __COMPANION_KEY__ / __HMAC_KEY__ placeholders; this fills them. Idempotent
# only against the template, so it keeps a pristine copy alongside.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
CK="$(tr -d '[:space:]' < .companion_key)"
HK="$(tr -d '[:space:]' < .hmac_key)"
[ "${#CK}" -eq 16 ] || { echo "companion key must be exactly 16 chars (got ${#CK})" >&2; exit 1; }
[ -f docker-compose.template.yml ] || cp docker-compose.yml docker-compose.template.yml
sed -e "s|__COMPANION_KEY__|$CK|g" -e "s|__HMAC_KEY__|$HK|g" docker-compose.template.yml > docker-compose.yml
echo "rendered docker-compose.yml"
