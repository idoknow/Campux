#!/usr/bin/env bash
set -euo pipefail
: "${KUBECONFIG_DATA:?}" "${GITHUB_SHA:?}" "${ADMIN_IMAGE:?}" "${DASH_IMAGE:?}" "${LANDING_IMAGE:?}"
umask 077
export KUBECONFIG="$(mktemp)"
trap 'rm -f "$KUBECONFIG"' EXIT
kubectl_retry() {
  local attempt=1 max_attempts=5 delay=2
  while true; do
    if kubectl --request-timeout=60s "$@"; then
      return 0
    fi
    if (( attempt >= max_attempts )); then
      printf 'kubectl command failed after %s attempts: %s\n' "$max_attempts" "$*" >&2
      return 1
    fi
    printf 'kubectl command failed (attempt %s/%s); retrying in %ss: %s\n' "$attempt" "$max_attempts" "$delay" "$*" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}
printf '%s' "$KUBECONFIG_DATA" > "$KUBECONFIG"
names=(campux-admin campux-dash campux-landing)
images=("$ADMIN_IMAGE" "$DASH_IMAGE" "$LANDING_IMAGE")
for image in "${images[@]}"; do
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || exit 1
done
deploy_one() {
  local name="$1" image="$2"
  local strategy_payload='{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":1,"maxUnavailable":0}}}}'
  kubectl_retry -n idoknow patch deployment "$name" --type merge -p "$strategy_payload" >/dev/null
  local payload
  payload="$(jq -nc --arg name "$name" --arg image "$image" --arg sha "$GITHUB_SHA" '{metadata:{annotations:{"campux.top/source-sha":$sha}},spec:{template:{metadata:{annotations:{"campux.top/source-sha":$sha}},spec:{containers:[{name:$name,image:$image,env:[{name:"CAMPUX_BUILD_VERSION",value:("deploy-prod-" + $sha[0:7])}]}]}}}}')"
  kubectl_retry -n idoknow patch deployment "$name" --type strategic -p "$payload"
  kubectl_retry -n idoknow rollout status "deployment/$name" --timeout=600s
  kubectl_retry -n idoknow get deployment "$name" -o json | jq -e --arg image "$image" --arg sha "$GITHUB_SHA" '.spec.template.spec.containers[0].image == $image and .metadata.annotations["campux.top/source-sha"] == $sha and .status.observedGeneration == .metadata.generation and .status.updatedReplicas == .spec.replicas and .status.availableReplicas == .spec.replicas'
}

# Each Deployment keeps its own maxSurge=1/maxUnavailable=0. Run the
# independent rollout-and-verification sequences concurrently to avoid making
# total deploy time the sum of all three rollout durations.
pids=()
for i in 0 1 2; do
  deploy_one "${names[$i]}" "${images[$i]}" &
  pids+=("$!")
done
failed=0
for i in 0 1 2; do
  if ! wait "${pids[$i]}"; then
    printf 'Deployment rollout failed: %s\n' "${names[$i]}" >&2
    failed=1
  fi
done
(( failed == 0 )) || exit 1
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://app.campux.top/api/health > /tmp/campux-health.json
jq -e '.ok == true' /tmp/campux-health.json
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://app.campux.top/api/about | jq -e --arg sha "${GITHUB_SHA:0:7}" '.version | endswith($sha)'
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://dash.campux.top/api/health
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors https://campux.top/ > /dev/null
