#!/usr/bin/env bash
# Checks a cluster for what console with swiss.enabled needs before a model can
# be deployed and chatted with. Read-only; uses the current kubectl context.
#
#   hack/preflight-swiss.sh --model-ns swiss-deploy --gateway-ns llm-route \
#     [--catalog https://.../] [--release-ns modelsphere]
#
# Exit 0 when nothing is FAIL; WARN lines are worth reading anyway.
set -uo pipefail

model_ns="" gateway_ns="" catalog="" release_ns="modelsphere"
while [ $# -gt 0 ]; do
  case "$1" in
    --model-ns) model_ns="$2"; shift 2 ;;
    --gateway-ns) gateway_ns="$2"; shift 2 ;;
    --catalog) catalog="$2"; shift 2 ;;
    --release-ns) release_ns="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

fails=0
ok() { printf '  ok    %s\n' "$*"; }
warn() { printf '  WARN  %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*"; fails=$((fails + 1)); }

crd() { kubectl get crd "$1" >/dev/null 2>&1; }
any_crd() {
  local what="$1"; shift
  for c in "$@"; do crd "$c" && { ok "$what ($c)"; return; }; done
  fail "$what: none of $* -- the model charts create these"
}

echo "cluster"
if ! kubectl version -o json >/dev/null 2>&1; then
  fail "kubectl cannot reach the cluster (context $(kubectl config current-context 2>/dev/null))"
  exit 1
fi
ok "context $(kubectl config current-context)"
kubectl auth can-i '*' '*' -A >/dev/null 2>&1 && ok "cluster-admin (the chart creates ClusterRoles and CRDs)" \
  || warn "not cluster-admin: helm install needs to create ClusterRoles, bindings and CRDs"

echo "CRDs the model charts render"
any_crd "LeaderWorkerSet" leaderworkersets.leaderworkerset.x-k8s.io
any_crd "LLMScaler" llmscalers.autoscaling.modelsphere.dev llmscalers.autoscaling.4pd.io
any_crd "LLMSLORequirement" llmslorequirements.inference.modelsphere.dev llmslorequirements.inference.x-k8s.io
any_crd "ModelRoute" modelroutes.routing.modelsphere.dev modelroutes.routing.gpucluster.io
crd servicemonitors.monitoring.coreos.com && ok "ServiceMonitor" \
  || warn "no ServiceMonitor CRD: a model chart with serviceMonitor on will fail to install"
if crd users.iam.theriseunion.io; then
  warn "iam.theriseunion.io CRDs already exist (Rise Global?): console shares its users; the chart leaves the CRDs alone"
else
  ok "iam CRDs absent: the chart installs them"
fi

echo "GPU"
gpus=$(kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.allocatable.nvidia\.com/gpu}{"\n"}{end}' | awk -F= '$2>0')
if [ -n "$gpus" ]; then
  ok "nodes with allocatable nvidia.com/gpu: $(echo "$gpus" | tr '\n' ' ')"
else
  fail "no node has allocatable nvidia.com/gpu"
fi

echo "namespaces"
for ns in "$model_ns" "$gateway_ns"; do
  [ -z "$ns" ] && continue
  kubectl get ns "$ns" >/dev/null 2>&1 && ok "namespace $ns" \
    || fail "namespace $ns does not exist (swissd does not create namespaces by default)"
done
[ -z "$model_ns" ] && warn "--model-ns not given: swiss.rbac.namespaces must name where models go"

echo "gateway (llm-openresty)"
if [ -n "$gateway_ns" ]; then
  routes=$(kubectl -n "$gateway_ns" get configmap -o go-template='{{range .items}}{{$n := .metadata.name}}{{range $k, $_ := .data}}{{if and (ge (len $k) 14) (eq (slice $k 0 14) "session_route_")}}{{$n}} {{end}}{{end}}{{end}}' 2>/dev/null | tr ' ' '\n' | sort -u | grep -v '^$')
  if [ -n "$routes" ]; then
    ok "route ConfigMaps in $gateway_ns: $(echo "$routes" | tr '\n' ' ') -> the profile's route.nginxConfigMap"
  else
    fail "no ConfigMap in $gateway_ns has session_route_*.conf keys"
  fi
  svcs=$(kubectl -n "$gateway_ns" get svc -o jsonpath='{range .items[*]}{.metadata.name}:{.spec.ports[0].port} {end}')
  [ -n "$svcs" ] && ok "Services in $gateway_ns: $svcs -> the profile's route.nginxService/nginxPort" \
    || fail "no Service in $gateway_ns"
  secrets=$(kubectl -n "$gateway_ns" get secret -o jsonpath='{range .items[?(@.type=="Opaque")]}{.metadata.name} {end}' 2>/dev/null)
  [ -n "$secrets" ] && ok "Opaque Secrets in $gateway_ns (one holds the gateway key): $secrets" \
    || warn "no Opaque Secret in $gateway_ns: does the gateway need no key?"
else
  warn "--gateway-ns not given: skipped"
fi

echo "platform"
default_sc=$(kubectl get sc -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{end}')
[ -n "$default_sc" ] && ok "default StorageClass $default_sc (swissd's database)" \
  || warn "no default StorageClass: set swiss.persistence.storageClass"
cni=$(kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep -o -m1 -E 'calico|cilium|antrea|kube-router|weave|flannel')
case "$cni" in
  flannel|"") warn "CNI ${cni:-unknown}: NetworkPolicy may not be enforced, leaving swissd (no login) open in-cluster" ;;
  *) ok "CNI $cni enforces NetworkPolicy" ;;
esac
kubectl get ns "$release_ns" >/dev/null 2>&1 && ok "release namespace $release_ns exists" \
  || ok "release namespace $release_ns will be created (--create-namespace)"
kubectl -n "$release_ns" get secret swr-creds >/dev/null 2>&1 && ok "pull secret swr-creds in $release_ns" \
  || warn "no swr-creds in $release_ns: create it before installing, or the images will not pull"

if [ -n "$catalog" ]; then
  echo "catalog (from this machine; the cluster must reach it too)"
  url="$catalog"; case "$url" in *.json) ;; *) url="${url%/}/index.json" ;; esac
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)
  [ "$code" = 200 ] && ok "$url" || fail "$url answered ${code:-nothing}"
fi

echo
[ "$fails" = 0 ] && echo "no FAIL" || echo "$fails FAIL"
exit $((fails > 0))
