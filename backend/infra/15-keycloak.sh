#!/usr/bin/env bash
# Keycloak (https://www.keycloak.org, Apache-2.0): the open-source identity broker behind enterprise SSO (登入與 SSO).
#   Microsoft Entra ID = an identity provider in realm "medisense"; LDAP / AD = read-only user federation in the same realm.
#   Identity Platform trusts the realm as ONE OIDC provider (oidc.medisense-sso), so Firebase stays the only session layer and
#   the backend keeps verifying Firebase ID tokens. Google Workspace stays Firebase's own Google provider (uids unchanged).
#   The Medisense admin page (routers/sso.py) configures Entra / LDAP through Keycloak's admin REST API with the
#   service-account client "medisense-backend"; Entra secrets and LDAP bind passwords live only in Keycloak's database.
#
# Prerequisites: source infra/env.sh; infra/10-open-connector.sh already created Cloud SQL instance medisense-oc-db (this adds a
# database to it); the project is upgraded to Identity Platform (Firebase console → Authentication → Settings → Upgrade);
# curl, jq, openssl.
# Cost: Keycloak keeps one instance warm (JVM cold starts take ~30 s): about US$40-70 / month at 1 vCPU / 2 GiB. Identity
# Platform bills OIDC sign-ins per monthly active user (first 49 free, then about US$0.015).
# Re-run: idempotent. Existing realm, clients, secrets and the Identity Platform provider are kept (the provider is updated).
# LDAP inside the hospital: set KC_VPC=1 so Keycloak reaches private ranges through the default VPC (VPN / Interconnect).
set -euo pipefail
: "${PROJECT_ID:?run: source infra/env.sh}"
KC_VERSION="${KC_VERSION:-26.4}"                 # pin a patch release (e.g. 26.4.2) for production
SOCKET_FACTORY_VERSION="${SOCKET_FACTORY_VERSION:-1.21.0}"
KC_SERVICE="medisense-keycloak"; KC_SA="medisense-kc-sa"; KC_SQL="medisense-oc-db"; KC_DB="keycloak"; KC_DB_USER="keycloak"
REALM="medisense"; IDP_CLIENT="identity-platform"; BACKEND_CLIENT="medisense-backend"; OIDC_PROVIDER="oidc.medisense-sso"
AUTH_HANDLERS="${AUTH_HANDLERS:-https://${PROJECT_ID}.firebaseapp.com/__/auth/handler https://medisense-portal.web.app/__/auth/handler}"
IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/keycloak:${KC_VERSION}-cloudsql"
SA_EMAIL="${KC_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
BACKEND_EMAIL="${BACKEND_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
SQL_CONN="${PROJECT_ID}:${REGION}:${KC_SQL}"
# Deterministic Cloud Run URL: known before the first deploy, so KC_HOSTNAME, the issuer and every redirect URI agree.
KC_URL="https://${KC_SERVICE}-${PROJECT_NUMBER:?PROJECT_NUMBER empty: gcloud auth?}.${REGION}.run.app"
say() { printf '\n== %s\n' "$*"; }
secret_exists() { gcloud secrets describe "$1" --project "$PROJECT_ID" >/dev/null 2>&1; }
mk_secret() { secret_exists "$1" || { printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=user-managed --locations="$REGION" --project "$PROJECT_ID" >/dev/null; echo "created $1"; }; }
put_secret() { if secret_exists "$1"; then printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- --project "$PROJECT_ID" >/dev/null; else mk_secret "$1" "$2"; fi; }
read_secret() { gcloud secrets versions access latest --secret "$1" --project "$PROJECT_ID"; }
for t in curl jq openssl; do command -v "$t" >/dev/null || { echo "missing: $t" >&2; exit 1; }; done

say "1/7 image: Keycloak + Cloud SQL socket factory, optimized build (Cloud Run cannot pull from quay.io)"
if gcloud artifacts docker images describe "$IMG" --project "$PROJECT_ID" >/dev/null 2>&1; then echo "exists: $IMG"; else
  CTX="$(mktemp -d)"
  cat > "$CTX/Dockerfile" <<DOCKER
FROM quay.io/keycloak/keycloak:${KC_VERSION} AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true
# Cloud SQL Java connector: JDBC over IAM-authorized TLS, no public authorized networks and no proxy sidecar.
ADD --chmod=644 https://repo1.maven.org/maven2/com/google/cloud/sql/postgres-socket-factory/${SOCKET_FACTORY_VERSION}/postgres-socket-factory-${SOCKET_FACTORY_VERSION}-jar-with-dependencies.jar /opt/keycloak/providers/
RUN /opt/keycloak/bin/kc.sh build
FROM quay.io/keycloak/keycloak:${KC_VERSION}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
DOCKER
  gcloud builds submit "$CTX" --tag "$IMG" --project "$PROJECT_ID" --region "$REGION"
  rm -rf "$CTX"
fi

say "2/7 service account (Cloud SQL client only)"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$KC_SA" --display-name "Medisense Keycloak" --project "$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${SA_EMAIL}" --role roles/cloudsql.client --condition=None >/dev/null

say "3/7 database ${KC_DB} on ${KC_SQL} and secrets (random values are generated here and never printed)"
gcloud sql instances describe "$KC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1 || { echo "Cloud SQL ${KC_SQL} missing: run infra/10-open-connector.sh first" >&2; exit 1; }
gcloud sql databases describe "$KC_DB" --instance "$KC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud sql databases create "$KC_DB" --instance "$KC_SQL" --project "$PROJECT_ID"
if ! secret_exists kc-db-password; then
  PW="$(openssl rand -hex 24)"
  gcloud sql users describe "$KC_DB_USER" --instance "$KC_SQL" --project "$PROJECT_ID" >/dev/null 2>&1 && \
    gcloud sql users set-password "$KC_DB_USER" --instance "$KC_SQL" --password "$PW" --project "$PROJECT_ID" >/dev/null || \
    gcloud sql users create "$KC_DB_USER" --instance "$KC_SQL" --password "$PW" --project "$PROJECT_ID" >/dev/null
  mk_secret kc-db-password "$PW"; unset PW
fi
mk_secret kc-admin-password "$(openssl rand -base64 24 | tr -d '=+/')"
for s in kc-db-password kc-admin-password; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null
done

say "4/7 Cloud Run service (public: browsers reach the login page; the admin console is protected by Keycloak itself)"
NET=(); if [ "${KC_VPC:-0}" = "1" ]; then NET=(--network default --subnet default --vpc-egress private-ranges-only); fi
gcloud run deploy "$KC_SERVICE" --image "$IMG" --region "$REGION" --project "$PROJECT_ID" --service-account "$SA_EMAIL" \
  --allow-unauthenticated --port 8080 --cpu 1 --memory 2Gi --min-instances 1 --max-instances 2 --concurrency 80 --timeout 300 \
  --cpu-boost --add-cloudsql-instances "$SQL_CONN" ${NET[@]+"${NET[@]}"} \
  --set-env-vars "^|^KC_HOSTNAME=${KC_URL}|KC_HTTP_ENABLED=true|KC_PROXY_HEADERS=xforwarded|KC_DB_URL=jdbc:postgresql:///${KC_DB}?cloudSqlInstance=${SQL_CONN}&socketFactory=com.google.cloud.sql.postgres.SocketFactory|KC_DB_USERNAME=${KC_DB_USER}|KC_BOOTSTRAP_ADMIN_USERNAME=kcadmin|KC_LOG_LEVEL=INFO" \
  --set-secrets "KC_DB_PASSWORD=kc-db-password:latest,KC_BOOTSTRAP_ADMIN_PASSWORD=kc-admin-password:latest"
echo "waiting for ${KC_URL} ..."
for _ in $(seq 1 60); do curl -fsS -o /dev/null "${KC_URL}/realms/master" && break; sleep 5; done
curl -fsS -o /dev/null "${KC_URL}/realms/master" || { echo "Keycloak did not come up; see: gcloud run services logs read ${KC_SERVICE} --region ${REGION}" >&2; exit 1; }

say "5/7 realm ${REALM} and clients (admin REST API)"
TOKEN="$(curl -fsS "${KC_URL}/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli \
  -d username=kcadmin --data-urlencode "password=$(read_secret kc-admin-password)" | jq -r .access_token)"
kc() { local m="$1" p="$2"; shift 2; curl -sS -X "$m" "${KC_URL}/admin/realms${p}" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' "$@"; }
code() { local m="$1" p="$2"; shift 2; kc "$m" "$p" -o /dev/null -w '%{http_code}' "$@"; }
c="$(code POST "" --data "$(jq -n --arg r "$REALM" '{realm:$r,enabled:true,displayName:"Medisense",loginWithEmailAllowed:true,duplicateEmailsAllowed:false,registrationAllowed:false,resetPasswordAllowed:false,rememberMe:false,sslRequired:"external",bruteForceProtected:true}')")"
case "$c" in 201) echo "created realm ${REALM}";; 409) echo "realm ${REALM} exists";; *) echo "realm create failed: $c" >&2; exit 1;; esac
client_id_of() { kc GET "/${REALM}/clients?clientId=$1" | jq -r '.[0].id // empty'; }
REDIRECTS="$(printf '%s\n' $AUTH_HANDLERS | jq -R . | jq -s .)"
if [ -z "$(client_id_of "$IDP_CLIENT")" ]; then
  kc POST "/${REALM}/clients" --data "$(jq -n --arg id "$IDP_CLIENT" --argjson r "$REDIRECTS" '{clientId:$id,name:"Firebase / Identity Platform",protocol:"openid-connect",publicClient:false,standardFlowEnabled:true,directAccessGrantsEnabled:false,serviceAccountsEnabled:false,implicitFlowEnabled:false,redirectUris:$r,webOrigins:[],attributes:{"pkce.code.challenge.method":""}}')" >/dev/null
  echo "created client ${IDP_CLIENT}"
else
  ID="$(client_id_of "$IDP_CLIENT")"; kc PUT "/${REALM}/clients/${ID}" --data "$(kc GET "/${REALM}/clients/${ID}" | jq --argjson r "$REDIRECTS" '.redirectUris=$r')" >/dev/null
  echo "client ${IDP_CLIENT} exists (redirect URIs refreshed)"
fi
if [ -z "$(client_id_of "$BACKEND_CLIENT")" ]; then
  kc POST "/${REALM}/clients" --data "$(jq -n --arg id "$BACKEND_CLIENT" '{clientId:$id,name:"Medisense backend (登入與 SSO settings)",protocol:"openid-connect",publicClient:false,standardFlowEnabled:false,directAccessGrantsEnabled:false,serviceAccountsEnabled:true,implicitFlowEnabled:false}')" >/dev/null
  echo "created client ${BACKEND_CLIENT}"
fi
BID="$(client_id_of "$BACKEND_CLIENT")"; RM="$(client_id_of realm-management)"
SVC_USER="$(kc GET "/${REALM}/clients/${BID}/service-account-user" | jq -r .id)"
ROLES="$(for r in manage-identity-providers view-identity-providers manage-realm view-realm; do kc GET "/${REALM}/clients/${RM}/roles/${r}"; done | jq -s '[.[]|{id,name}]')"
kc POST "/${REALM}/users/${SVC_USER}/role-mappings/clients/${RM}" --data "$ROLES" >/dev/null
put_secret kc-idp-client-secret "$(kc GET "/${REALM}/clients/$(client_id_of "$IDP_CLIENT")/client-secret" | jq -r .value)"
put_secret kc-backend-client-secret "$(kc GET "/${REALM}/clients/${BID}/client-secret" | jq -r .value)"
gcloud secrets add-iam-policy-binding kc-backend-client-secret --member "serviceAccount:${BACKEND_EMAIL}" --role roles/secretmanager.secretAccessor --project "$PROJECT_ID" >/dev/null
unset TOKEN

say "6/7 Identity Platform trusts the realm: OIDC provider ${OIDC_PROVIDER} (code flow)"
GTOKEN="$(gcloud auth print-access-token)"
IDP_BODY="$(jq -n --arg iss "${KC_URL}/realms/${REALM}" --arg cid "$IDP_CLIENT" --arg sec "$(read_secret kc-idp-client-secret)" \
  '{displayName:"Medisense SSO",enabled:true,issuer:$iss,clientId:$cid,clientSecret:$sec,responseType:{code:true,idToken:false}}')"
IT="https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/oauthIdpConfigs"
c="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${IT}?oauthIdpConfigId=${OIDC_PROVIDER}" -H "Authorization: Bearer ${GTOKEN}" -H "x-goog-user-project: ${PROJECT_ID}" -H 'Content-Type: application/json' --data "$IDP_BODY")"
if [ "$c" = "409" ]; then
  c="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${IT}/${OIDC_PROVIDER}?updateMask=displayName,enabled,issuer,clientId,clientSecret,responseType" -H "Authorization: Bearer ${GTOKEN}" -H "x-goog-user-project: ${PROJECT_ID}" -H 'Content-Type: application/json' --data "$IDP_BODY")"
fi
unset GTOKEN IDP_BODY
case "$c" in 200) echo "provider ${OIDC_PROVIDER} ready";;
  *) echo "warning: Identity Platform answered ${c}. Is the project upgraded to Identity Platform (Firebase console → Authentication → Settings)? Re-run this step after upgrading." >&2;; esac

say "7/7 done"
echo "Keycloak:      ${KC_URL}   (admin console ${KC_URL}/admin, user kcadmin, password in secret kc-admin-password)"
echo "OIDC issuer:   ${KC_URL}/realms/${REALM}"
echo "Entra app redirect URI (shown on 登入與 SSO too): ${KC_URL}/realms/${REALM}/broker/entra/endpoint"
echo "Next: re-run infra/04-deploy-backend.sh; it adds KEYCLOAK_URL, KEYCLOAK_REALM=${REALM}, KEYCLOAK_CLIENT_ID=${BACKEND_CLIENT} and secret kc-backend-client-secret."
echo "Then: 管理帳戶 → 登入與 SSO configures Microsoft Entra ID and LDAP. Replace the temporary bootstrap admin kcadmin with a named admin in the Keycloak console."
