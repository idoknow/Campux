#!/usr/bin/env bash
set -euo pipefail
: "${KUBECONFIG_DATA:?}" "${GITHUB_SHA:?}" "${ADMIN_IMAGE:?}" "${DASH_IMAGE:?}" "${LANDING_IMAGE:?}"
umask 077
export KUBECONFIG="$(mktemp)"
trap 'rm -f "$KUBECONFIG"' EXIT
printf '%s' "$KUBECONFIG_DATA" > "$KUBECONFIG"
names=(campux-admin campux-dash campux-landing)
images=("$ADMIN_IMAGE" "$DASH_IMAGE" "$LANDING_IMAGE")
for image in "${images[@]}"; do
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || exit 1
done
for i in 0 1 2; do
  name="${names[$i]}"
  strategy_payload='{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'
  kubectl --request-timeout=60s -n idoknow patch deployment "$name" --type merge -p "$strategy_payload" >/dev/null
  payload="$(jq -nc --arg name "$name" --arg image "${images[$i]}" --arg sha "$GITHUB_SHA" '{metadata:{annotations:{"campux.top/source-sha":$sha}},spec:{template:{metadata:{annotations:{"campux.top/source-sha":$sha}},spec:{containers:[{name:$name,image:$image,env:[{name:"CAMPUX_BUILD_VERSION",value:("deploy-prod-" + $sha[0:7])}]}]}}}}')"
  kubectl --request-timeout=60s -n idoknow patch deployment "$name" --type strategic -p "$payload"
  kubectl --request-timeout=60s -n idoknow rollout status "deployment/$name" --timeout=600s
  kubectl --request-timeout=60s -n idoknow get deployment "$name" -o json | jq -e --arg image "${images[$i]}" --arg sha "$GITHUB_SHA" '.spec.template.spec.containers[0].image == $image and .metadata.annotations["campux.top/source-sha"] == $sha and .status.observedGeneration == .metadata.generation and .status.updatedReplicas == .spec.replicas and .status.availableReplicas == .spec.replicas'
done
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://app.campux.top/api/health > /tmp/campux-health.json
jq -e '.ok == true' /tmp/campux-health.json
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://app.campux.top/api/about | jq -e --arg sha "${GITHUB_SHA:0:7}" '.version | endswith($sha)'
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://dash.campux.top/api/health
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://campux.top/ > /dev/null
