#!/usr/bin/env bash
# Local SSO playground for 登入與 SSO: Keycloak + a test OpenLDAP in Docker, realm "medisense" with the backend's admin client,
# and backend/.env.sso-local for a local backend (SSO_CONFIG_DOC=sso-local, so the deployed login page is never affected).
# What works locally: the settings page end to end (save Entra / LDAP into Keycloak, LDAP 測試連線 / 測試 Bind 帳號).
# What does not: signing in with Microsoft / LDAP. Identity Platform must reach Keycloak on a public URL (infra/15-keycloak.sh).
# Stop everything: docker rm -f ms-keycloak ms-openldap
set -euo pipefail
cd "$(dirname "$0")/.."
KC=http://localhost:8180; NET=medisense-sso-dev; REALM=medisense
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
docker inspect ms-keycloak >/dev/null 2>&1 || docker run -d --name ms-keycloak --network "$NET" -p 8180:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:26.4 start-dev >/dev/null
docker inspect ms-openldap >/dev/null 2>&1 || docker run -d --name ms-openldap --network "$NET" -p 1389:389 \
  -e LDAP_ORGANISATION="Test Hospital" -e LDAP_DOMAIN=hospital.local -e LDAP_ADMIN_PASSWORD=admin osixia/openldap:1.5.0 >/dev/null
docker start ms-keycloak ms-openldap >/dev/null

echo "waiting for Keycloak on ${KC} (first start pulls the image, ~1 min) ..."
for _ in $(seq 1 90); do curl -fsS -o /dev/null "${KC}/realms/master" 2>/dev/null && break; sleep 2; done
TOKEN="$(curl -fsS "${KC}/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli -d username=admin -d password=admin | jq -r .access_token)"
kc() { local m="$1" p="$2"; shift 2; curl -sS -X "$m" "${KC}/admin/realms${p}" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' "$@"; }
kc POST "" --data '{"realm":"medisense","enabled":true,"displayName":"Medisense","loginWithEmailAllowed":true,"duplicateEmailsAllowed":false}' -o /dev/null
cid() { kc GET "/${REALM}/clients?clientId=$1" | jq -r '.[0].id // empty'; }
[ -n "$(cid medisense-backend)" ] || kc POST "/${REALM}/clients" -o /dev/null \
  --data '{"clientId":"medisense-backend","protocol":"openid-connect","publicClient":false,"standardFlowEnabled":false,"directAccessGrantsEnabled":false,"serviceAccountsEnabled":true}'
BID="$(cid medisense-backend)"; RM="$(cid realm-management)"
SVC="$(kc GET "/${REALM}/clients/${BID}/service-account-user" | jq -r .id)"
ROLES="$(for r in manage-identity-providers view-identity-providers manage-realm view-realm; do kc GET "/${REALM}/clients/${RM}/roles/${r}"; done | jq -s '[.[]|{id,name}]')"
kc POST "/${REALM}/users/${SVC}/role-mappings/clients/${RM}" --data "$ROLES" -o /dev/null
SECRET="$(kc GET "/${REALM}/clients/${BID}/client-secret" | jq -r .value)"

# A test person in the directory (bind tests work with the admin DN; this is just something to find).
docker exec -i ms-openldap ldapadd -x -D cn=admin,dc=hospital,dc=local -w admin >/dev/null 2>&1 <<'LDIF' || true
dn: ou=people,dc=hospital,dc=local
objectClass: organizationalUnit
ou: people

dn: uid=nurse01,ou=people,dc=hospital,dc=local
objectClass: inetOrgPerson
uid: nurse01
cn: Nurse 01
sn: 01
mail: nurse01@hospital.local
userPassword: nurse01
LDIF

cat > .env.sso-local <<ENV
# Written by scripts/sso-local.sh (gitignored). Local backend against the sandbox Firestore + local Keycloak.
GOOGLE_CLOUD_PROJECT=cloud-sa-sandbox-1
REGION=asia-east1
FIRESTORE_DATABASE=tcvgh-agent-platform
UPLOAD_BUCKET=cloud-sa-sandbox-1-tcvgh-agent-uploads
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=local-dev-no-chat
ALLOWED_DOMAINS=ikala.ai,cloud.ikala.tv
ADMIN_EMAILS=esther.shih@ikala.ai,paggie.chen@ikala.ai
SSO_CONFIG_DOC=sso-local
KEYCLOAK_URL=${KC}
KEYCLOAK_REALM=${REALM}
KEYCLOAK_CLIENT_ID=medisense-backend
KEYCLOAK_CLIENT_SECRET=${SECRET}
ENV
echo
echo "Keycloak ready: ${KC}/admin (admin / admin). backend/.env.sso-local written."
echo "LDAP card values (Keycloak reaches the directory inside Docker):"
echo "  目錄類型 OpenLDAP / 其他 · 連線網址 ldap://ms-openldap:389 · Bind DN cn=admin,dc=hospital,dc=local · Bind 密碼 admin · 使用者所在 DN ou=people,dc=hospital,dc=local"
