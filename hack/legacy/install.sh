#!/usr/bin/env bash
# console 安装器：把 console 装进一个已经跑着 swissd 和推理网关的集群，并验证能用。
# 用法见 ./install.sh --help
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

# 默认使用 CI 发布到 GHCR 的镜像，tag 与本仓库 Chart 的 appVersion 一致。
CONSOLE_IMAGE_REPO=${CONSOLE_IMAGE_REPO:-ghcr.io/modelsphere/console}
CONSOLE_IMAGE_TAG=${CONSOLE_IMAGE_TAG:-$(sed -n 's/^appVersion: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/p' "$here/helm/console/Chart.yaml")}
DEFAULT_ADMIN_PASSWORD='P@88w0rd'
REGISTRY_SECRET_NAME=console-registry

usage() {
  cat <<'EOF'
console 安装器

  ./install.sh [命令] [选项]

命令
  install     安装或升级（默认）。可重复执行
  verify      只做验证：登录 → 模型部署 → Playground 列模型并对话
  status      release、Pod、接线和访问地址
  uninstall   卸载 release

选项
  -n, --namespace NS        安装到的命名空间（默认 modelsphere）
  -r, --release NAME        helm release 名（默认 console）
      --chart PATH          chart 目录或 .tgz（默认 ./helm/console，或同目录下的 console-*.tgz）
      --image-tag TAG       console 镜像 tag（默认 $CONSOLE_IMAGE_TAG）
      --swiss REF           swissd：auto（默认，按标签 app.kubernetes.io/name=swiss 查找）、
                            <ns>/<service>、http(s)://.../api，或 none（不接模型部署）
      --gateway-profile REF swiss 站点配置 ConfigMap <ns>/<name>；默认取 swissd 当前用的那个
      --gateway-configmap REF   openresty 路由 ConfigMap <ns>/<name>（没有站点配置时用）
      --gateway-service REF     openresty Service <ns>/<name>
      --gateway-secret REF      openresty key Secret <ns>/<name>
      --demo                不用集群里的网关，装 CPU 演示模型，Playground 和 /v1 直连它
      --registry-secret NAME    已存在的镜像拉取 Secret（在目标命名空间）
      --admin-username NAME     种子管理员用户名（默认 admin）
      --service-type TYPE   NodePort（默认）| ClusterIP | LoadBalancer
      --node-port PORT      固定 NodePort
  -f, --values FILE         额外的 helm values，可多次给出，最后生效
      --timeout DUR         等待就绪的时间（默认 10m）
      --skip-chat           验证时不发对话请求
      --dry-run             只做发现并打印将使用的 values，不安装
  -y, --yes                 uninstall 不再确认
  -h, --help

环境变量
  CONSOLE_ADMIN_PASSWORD    管理员密码。首次安装时设置它，验证会用默认密码登录并改成它；
                            管理员已存在时用它登录
  REGISTRY_USERNAME / REGISTRY_PASSWORD
                            创建镜像拉取 Secret（console-registry）；已有 Secret 用 --registry-secret
  KUBECONFIG                目标集群

前提：集群里已有推理网关（llm-openresty + autoconfig），要接模型部署还需要 swissd
（auth.disabled=true）。安装器会自动发现它们，发现不了时用上面的选项指定。
EOF
}

cmd=install
ns=modelsphere
release=console
chart=""
image_tag=$CONSOLE_IMAGE_TAG
swiss=auto
gw_profile=""
gw_cm=""
gw_svc=""
gw_secret=""
demo=0
registry_secret=""
admin_user="admin"
admin_user_given=0
service_type=NodePort
node_port=""
timeout=10m
skip_chat=0
dry_run=0
yes=0
user_values=()

while [ $# -gt 0 ]; do
  case "$1" in
    install|upgrade) cmd=install ;;
    verify|status|uninstall) cmd=$1 ;;
    -n|--namespace) ns=$2; shift ;;
    -r|--release) release=$2; shift ;;
    --chart) chart=$2; shift ;;
    --image-tag) image_tag=$2; shift ;;
    --swiss) swiss=$2; shift ;;
    --gateway-profile) gw_profile=$2; shift ;;
    --gateway-configmap) gw_cm=$2; shift ;;
    --gateway-service) gw_svc=$2; shift ;;
    --gateway-secret) gw_secret=$2; shift ;;
    --demo) demo=1 ;;
    --registry-secret) registry_secret=$2; shift ;;
    --admin-username) admin_user=$2; admin_user_given=1; shift ;;
    --service-type) service_type=$2; shift ;;
    --node-port) node_port=$2; shift ;;
    -f|--values) user_values+=(-f "$2"); shift ;;
    --timeout) timeout=$2; shift ;;
    --skip-chat) skip_chat=1 ;;
    --dry-run) dry_run=1 ;;
    -y|--yes) yes=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1（见 --help）" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B="" G="" Y="" R="" N=""; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok() { printf '  %sok%s    %s\n' "$G" "$N" "$*"; }
warn() { printf '  %sWARN%s  %s\n' "$Y" "$N" "$*"; }
fail() { printf '  %sFAIL%s  %s\n' "$R" "$N" "$*"; }
die() { printf '\n%s错误：%s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# console's own Service (the one with the http port), whatever fullnameOverride says.
fullname() {
  local n
  n=$(kubectl -n "$ns" get svc -l "app.kubernetes.io/instance=$release,app.kubernetes.io/name=console" \
    -o jsonpath='{range .items[*]}{.metadata.name} {.spec.ports[0].name}{"\n"}{end}' 2>/dev/null | awk '$2=="http"{print $1; exit}')
  echo "${n:-$release-console}"
}

pyjson() { local code=$1; shift; python3 -c "import json,sys; d=json.load(sys.stdin); $code" "$@"; }

split_ref() { # ref default_ns -> "ns name"
  case "$1" in */*) echo "${1%%/*} ${1#*/}" ;; *) echo "$2 $1" ;; esac
}

preflight() {
  step "检查环境"
  local t
  for t in kubectl helm python3 curl; do
    command -v "$t" >/dev/null || die "需要 $t"
  done
  kubectl version -o json >/dev/null 2>&1 || die "kubectl 连不上集群（KUBECONFIG=${KUBECONFIG:-~/.kube/config}）"
  ok "集群：$(kubectl config current-context 2>/dev/null || echo '?')"
  ok "helm $(helm version --short 2>/dev/null)"
  if [ "$cmd" = install ]; then
    for t in "create customresourcedefinitions" "create clusterroles" "create clusterrolebindings"; do
      kubectl auth can-i $t >/dev/null 2>&1 || warn "当前身份不能 $t：chart 需要这些权限"
    done
  fi
  if [ -z "$chart" ]; then
    if [ -f "$here/helm/console/Chart.yaml" ]; then chart=$here/helm/console
    else chart=$(ls "$here"/console-*.tgz 2>/dev/null | tail -1 || true); fi
  fi
  [ -n "$chart" ] && [ -e "$chart" ] || die "找不到 chart，用 --chart 指定"
  if [ -d "$chart" ]; then
    helm dependency build "$chart" >/dev/null || die "拉取 chart 依赖失败（swiss chart，见 $chart/Chart.yaml）"
  fi
  ok "chart：$chart"
}

swiss_url="" swiss_ns="" swiss_svc="" swiss_port="" swiss_profile=""

swiss_get() { kubectl get --raw "/api/v1/namespaces/$swiss_ns/services/$swiss_svc:$swiss_port/proxy/api/$1"; }

discover_swiss() {
  step "发现 swissd（模型部署）"
  case "$swiss" in
    none) ok "不接模型部署（--swiss none）"; return ;;
    http://*|https://*) swiss_url=${swiss%/}; case "$swiss_url" in */api) ;; *) swiss_url=$swiss_url/api ;; esac
      ok "使用指定地址 $swiss_url（集群外地址，不做探测）"; return ;;
    auto)
      local found
      found=$(kubectl get svc -A -l app.kubernetes.io/name=swiss -o json | pyjson '
for s in d["items"]:
    ports = s["spec"]["ports"]
    p = next((x for x in ports if x.get("name") == "http"), ports[0])
    print(s["metadata"]["namespace"], s["metadata"]["name"], p["port"])')
      case $(printf '%s' "$found" | grep -c . || true) in
        0) warn "集群里没有 swissd（标签 app.kubernetes.io/name=swiss）。模型部署菜单会报 502；装好 swissd 后重跑，或用 --swiss 指定"; return ;;
        1) read -r swiss_ns swiss_svc swiss_port <<<"$found" ;;
        *) die "找到多个 swissd，用 --swiss <ns>/<service> 选一个：
$found" ;;
      esac ;;
    *)
      read -r swiss_ns swiss_svc <<<"$(split_ref "$swiss" "")"
      [ -n "$swiss_ns" ] || die "--swiss 要写成 <ns>/<service>"
      swiss_port=$(kubectl -n "$swiss_ns" get svc "$swiss_svc" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null) || die "Service $swiss not found" ;;
  esac
  swiss_url="http://$swiss_svc.$swiss_ns.svc:$swiss_port/api"
  ok "swissd：$swiss_ns/$swiss_svc:$swiss_port"

  local session cluster
  if ! session=$(swiss_get session 2>/dev/null); then
    warn "探测不到 swissd 的 /api/session（Pod 没就绪，或当前身份不能代理 services）"
    return
  fi
  if [ "$(printf '%s' "$session" | pyjson 'print(d.get("authDisabled", False))')" != True ]; then
    warn "swissd 开着自己的登录：console 转发的是 console 的令牌，swissd 不认，模型部署会 401。swissd 要以 auth.disabled=true 安装"
  else
    ok "swissd 没有自己的登录（由 console 负责）"
  fi
  if [ "$(printf '%s' "$session" | pyjson 'print(d.get("initialized", False))')" != True ]; then
    warn "swissd 还没有站点配置：第一次打开 模型部署 会进入设置页"
  fi
  if cluster=$(swiss_get cluster 2>/dev/null); then
    swiss_profile=$(printf '%s' "$cluster" | pyjson 'print(d.get("profile") or "")')
    ok "集群名 $(printf '%s' "$cluster" | pyjson 'print(d.get("name") or "-")')，模型目录 $(printf '%s' "$cluster" | pyjson 'print(d.get("catalog") or "-")')"
  fi
}

gw_mode="" gw_secret_key=""

profile_field() { # yaml field -> value; the route fields are unique names in a site profile
  printf '%s\n' "$1" | sed -n "s/^[[:space:]]*$2:[[:space:]]*//p" | head -1 | sed -e 's/[[:space:]]#.*$//' -e 's/^["'"'"']//' -e 's/["'"'"']$//'
}

openresty_for_cm() { # ns cm -> "secret service port" of the Deployment mounting that ConfigMap
  kubectl -n "$1" get deploy,svc -o json | pyjson '
cm = sys.argv[1]
deps = [x for x in d["items"] if x["kind"] == "Deployment"]
svcs = [x for x in d["items"] if x["kind"] == "Service"]
for dep in deps:
    vols = dep["spec"]["template"]["spec"].get("volumes", [])
    if not any(v.get("configMap", {}).get("name") == cm for v in vols):
        continue
    secret = next((v["secret"]["secretName"] for v in vols if v.get("name") == "api-keys" and "secret" in v), "")
    labels = dep["spec"]["template"]["metadata"].get("labels", {})
    svc, port = "", 0
    for s in svcs:
        sel = s["spec"].get("selector") or {}
        if sel and all(labels.get(k) == v for k, v in sel.items()):
            ports = [p["port"] for p in s["spec"]["ports"]]
            svc, port = s["metadata"]["name"], (8080 if 8080 in ports else ports[0])
            break
    print(secret or "-", svc or "-", port)
    break' "$2"
}

discover_gateway() {
  step "发现推理网关（Playground 和 /v1）"
  if [ "$demo" = 1 ]; then gw_mode=demo; ok "不用网关，装 CPU 演示模型（--demo）"; return; fi

  local profile="" text=""
  if [ -z "$gw_profile" ] && [ -z "$gw_cm" ]; then gw_profile=$swiss_profile; fi
  if [ -n "$gw_profile" ]; then
    local pns pname
    read -r pns pname <<<"$(split_ref "$gw_profile" "")"
    if text=$(kubectl -n "$pns" get cm "$pname" -o jsonpath='{.data.profile\.yaml}' 2>/dev/null) && [ -n "$text" ]; then
      profile=$gw_profile
      ok "站点配置 $profile"
      [ -n "$gw_cm" ] || gw_cm=$(profile_field "$text" nginxConfigMap)
      local psvc psec
      psvc=$(profile_field "$text" nginxService)
      psec=$(profile_field "$text" secretRef)
      gw_secret_key=$(profile_field "$text" secretKey)
      # Passed on even when the profile names them: the chart grants console read
      # access only in the namespaces of the references it is given.
      [ -n "$psvc" ] && [ -z "$gw_svc" ] && gw_svc=$psvc && ok "  入口 Service 取自站点配置：$psvc"
      [ -n "$psec" ] && [ -z "$gw_secret" ] && gw_secret=$psec && ok "  key Secret 取自站点配置：$psec"
    else
      warn "站点配置 $gw_profile 还不存在（swissd 首次保存设置后才有），改为直接发现 openresty"
    fi
  fi

  if [ -z "$gw_cm" ]; then
    local cands
    cands=$(kubectl get cm -A -o json | pyjson '
for c in d["items"]:
    if any(k.startswith("session_route_") for k in (c.get("data") or {})):
        print(c["metadata"]["namespace"] + "/" + c["metadata"]["name"])')
    case $(printf '%s' "$cands" | grep -c . || true) in
      0) die "集群里没有 openresty 路由 ConfigMap（含 session_route_*.conf）。先装推理网关，或用 --demo" ;;
      1) gw_cm=$cands ;;
      *) die "找到多个 openresty 路由 ConfigMap，用 --gateway-configmap 选一个：
$cands" ;;
    esac
  fi
  local cns cname
  read -r cns cname <<<"$(split_ref "$gw_cm" "")"
  local routes
  routes=$(kubectl -n "$cns" get cm "$cname" -o json 2>/dev/null | pyjson 'print(" ".join(sorted(k[14:-5] for k in (d.get("data") or {}) if k.startswith("session_route_"))))') \
    || die "路由 ConfigMap $gw_cm 不存在"
  ok "路由 ConfigMap $gw_cm：${routes:-（还没有路由）}"

  if [ -z "$gw_svc" ] || [ -z "$gw_secret" ]; then
    local found fsec fsvc fport
    found=$(openresty_for_cm "$cns" "$cname")
    read -r fsec fsvc fport <<<"${found:-- - 0}"
    if [ -z "$gw_svc" ]; then
      [ "$fsvc" != - ] || die "找不到挂载 $gw_cm 的 openresty 的 Service，用 --gateway-service 指定"
      gw_svc=$cns/$fsvc
      [ "$fport" = 8080 ] || warn "Service $gw_svc 没有 8080 端口，console 默认连 8080"
      ok "入口 Service $gw_svc（从 openresty Deployment 发现）"
    fi
    if [ -z "$gw_secret" ]; then
      if [ "$fsec" != - ]; then gw_secret=$cns/$fsec; ok "key Secret $gw_secret（openresty 挂载的 api-keys）"
      else warn "openresty 没挂 key Secret：网关没开鉴权，console 不带 key 调用"; fi
    fi
  fi
  local svc_ns
  read -r svc_ns _ <<<"$(split_ref "$gw_svc" "$cns")"
  gw_svc=$svc_ns/${gw_svc#*/}

  if [ -n "$gw_secret" ]; then
    local sns sname entry=${gw_secret_key:-keys}
    # A bare Secret name is the entrypoint's namespace, as console reads it.
    read -r sns sname <<<"$(split_ref "$gw_secret" "$svc_ns")"
    gw_secret=$sns/$sname
    kubectl -n "$sns" get secret "$sname" -o json 2>/dev/null | pyjson "sys.exit(0 if '$entry' in (d.get('data') or {}) else 3)" \
      && ok "Secret $gw_secret 有条目 $entry" \
      || warn "Secret $gw_secret 里没有条目 $entry：Playground 会 502"
  fi

  if [ -n "$profile" ]; then gw_mode=profile; gw_profile=$profile; else gw_mode=configmap; gw_profile=""; fi
  ok "console 将按$( [ $gw_mode = profile ] && echo "站点配置 $gw_profile" || echo "路由 ConfigMap $gw_cm" )解析网关"
}

discover_registry() {
  step "镜像：$CONSOLE_IMAGE_REPO:$image_tag"
  if [ -n "$registry_secret" ]; then
    ok "拉取凭据：已有 Secret $registry_secret"
  elif [ -n "${REGISTRY_USERNAME:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ]; then
    registry_secret=$REGISTRY_SECRET_NAME
    ok "拉取凭据：将创建/更新 Secret $registry_secret（来自 REGISTRY_USERNAME/REGISTRY_PASSWORD）"
  elif kubectl -n "$ns" get secret "$REGISTRY_SECRET_NAME" >/dev/null 2>&1; then
    registry_secret=$REGISTRY_SECRET_NAME
    ok "拉取凭据：沿用已有的 $registry_secret"
  else
    warn "没有拉取凭据：镜像仓库是私有的话 Pod 会 ImagePullBackOff（设置 REGISTRY_USERNAME/REGISTRY_PASSWORD 或 --registry-secret）"
  fi
}

admin_foreign=0
discover_admin() {
  step "管理员 $admin_user"
  local owner
  if owner=$(kubectl get users.iam.theriseunion.io "$admin_user" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/instance}' 2>/dev/null); then
    if [ "$owner" = "$release" ]; then ok "已由本 release 创建"
    else
      admin_foreign=1
      warn "用户 $admin_user 已存在，属于 ${owner:-其他来源}（可能是 Rise Global 或另一个 console）。chart 不会改它，验证需要它的密码（CONSOLE_ADMIN_PASSWORD），或用 --admin-username 另建一个"
    fi
  else
    ok "将创建，初始密码 $DEFAULT_ADMIN_PASSWORD，首次登录要求改密码"
  fi
}

values_file=""
write_values() {
  values_file=$(mktemp -t console-values.XXXXXX.yaml)
  {
    printf 'image:\n  repository: "%s"\n  tag: "%s"\n' "$CONSOLE_IMAGE_REPO" "$image_tag"
    [ -n "$registry_secret" ] && printf 'imagePullSecrets:\n  - name: "%s"\n' "$registry_secret"
    printf 'admin:\n  username: "%s"\n' "$admin_user"
    printf 'service:\n  type: "%s"\n' "$service_type"
    [ -n "$node_port" ] && printf '  nodePort: "%s"\n' "$node_port"
    if [ -n "$swiss_url" ]; then
      printf 'backends:\n  - name: swiss\n    prefix: /api/deploy\n    url: "%s"\n' "$swiss_url"
    else
      printf 'backends: []\n'
    fi
    if [ "$gw_mode" = demo ]; then
      printf 'demo:\n  enabled: true\n'
    else
      printf 'playground:\n  gateway:\n'
      [ -n "$gw_profile" ] && printf '    profile: "%s"\n' "$gw_profile"
      [ "$gw_mode" = configmap ] && printf '    configMap: "%s"\n' "$gw_cm"
      [ -n "$gw_svc" ] && printf '    service: "%s"\n' "$gw_svc"
      [ -n "$gw_secret" ] && printf '    secretRef: "%s"\n' "$gw_secret"
    fi
  } >"$values_file"
}

ensure_registry_secret() {
  [ -n "${REGISTRY_USERNAME:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ] && [ "$registry_secret" = "$REGISTRY_SECRET_NAME" ] || return 0
  kubectl -n "$ns" create secret docker-registry "$registry_secret" \
    --docker-server="${CONSOLE_IMAGE_REPO%%/*}" \
    --docker-username="$REGISTRY_USERNAME" --docker-password="$REGISTRY_PASSWORD" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ok "Secret $registry_secret 已更新"
}

diagnose() {
  echo
  kubectl -n "$ns" get pods -l "app.kubernetes.io/instance=$release" -o wide 2>&1 | sed 's/^/    /'
  kubectl -n "$ns" get events --sort-by=.lastTimestamp 2>/dev/null | grep -E 'Warning|Failed|BackOff' | tail -8 | sed 's/^/    /'
}

do_install() {
  preflight
  release_admin
  discover_swiss
  discover_gateway
  discover_registry
  discover_admin
  write_values
  step "将使用的 values（$values_file）"
  sed 's/^/    /' "$values_file"
  if [ "$dry_run" = 1 ]; then
    helm template "$release" "$chart" -n "$ns" -f "$values_file" "${user_values[@]}" >/dev/null && ok "chart 渲染通过（--dry-run，未安装）"
    values_file=""
    return
  fi

  step "安装 $release 到 $ns"
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  ensure_registry_secret
  if ! helm upgrade --install "$release" "$chart" -n "$ns" -f "$values_file" "${user_values[@]}" --wait --timeout "$timeout" >/dev/null; then
    fail "helm 没有在 $timeout 内完成"
    diagnose
    exit 1
  fi
  ok "$(helm -n "$ns" status "$release" -o json | pyjson 'print("revision %s, %s" % (d["version"], d["info"]["status"]))')"
  rm -f "$values_file"
  do_verify
}

pf_pid=""
cleanup() { [ -n "$pf_pid" ] && kill "$pf_pid" 2>/dev/null; [ -n "$values_file" ] && rm -f "$values_file"; return 0; }
trap cleanup EXIT

base=""
open_tunnel() {
  local svc log port
  svc=$(fullname)
  kubectl -n "$ns" get svc "$svc" >/dev/null 2>&1 || die "Service $ns/$svc 不存在：release $release 装了吗？"
  log=$(mktemp)
  kubectl -n "$ns" port-forward --address 127.0.0.1 "svc/$svc" :8080 >"$log" 2>&1 &
  pf_pid=$!
  for _ in $(seq 50); do
    port=$(sed -n 's/^Forwarding from 127.0.0.1:\([0-9]*\).*/\1/p' "$log" | head -1)
    [ -n "$port" ] && break
    sleep 0.2
  done
  rm -f "$log"
  [ -n "$port" ] || die "kubectl port-forward 到 $svc 失败"
  base=http://127.0.0.1:$port
}

token=""
api() { # method path [json]
  local args=(-sS --noproxy '*' -m 60 -X "$1" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -w '\n%{http_code}')
  [ $# -ge 3 ] && args+=(--data "$3")
  curl "${args[@]}" "$base$2"
}
body() { printf '%s' "$1" | sed '$d'; }
code() { printf '%s' "$1" | tail -1; }

login() {
  local r
  r=$(curl -sS --noproxy '*' -m 20 "$base/oauth/token" --data-urlencode grant_type=password \
    --data-urlencode "username=$admin_user" --data-urlencode "password=$1" -w '\n%{http_code}') || return 1
  [ "$(code "$r")" = 200 ] || return 1
  token=$(body "$r" | pyjson 'print(d["access_token"])')
}

do_verify() {
  if [ "$cmd" = verify ]; then preflight; release_admin; discover_admin; fi
  step "验证"
  open_tunnel
  local failed=0 r
  local pw=${CONSOLE_ADMIN_PASSWORD:-}
  if [ -n "$pw" ] && login "$pw"; then
    ok "登录 $admin_user"
  elif [ "$admin_foreign" = 0 ] && login "$DEFAULT_ADMIN_PASSWORD"; then
    ok "登录 $admin_user（初始密码）"
    r=$(api GET /api/me)
    if [ "$(body "$r" | pyjson 'print(d.get("requirePasswordReset", False))')" = True ]; then
      if [ -z "$pw" ] || [ "$pw" = "$DEFAULT_ADMIN_PASSWORD" ]; then
        warn "管理员还要先改密码，其余验证跳过。浏览器登录改密码，或设置 CONSOLE_ADMIN_PASSWORD 后运行 ./install.sh verify"
        print_access
        return 0
      fi
      r=$(api POST /api/me/password "$(python3 -c 'import json,sys;print(json.dumps({"oldPassword":sys.argv[1],"newPassword":sys.argv[2]}))' "$DEFAULT_ADMIN_PASSWORD" "$pw")")
      [ "$(code "$r")" = 200 ] || [ "$(code "$r")" = 204 ] || die "改密码失败：$(body "$r")"
      login "$pw" || die "改密码后登录失败"
      ok "管理员密码已改为 CONSOLE_ADMIN_PASSWORD"
    fi
  else
    fail "登录 $admin_user 失败：设置正确的 CONSOLE_ADMIN_PASSWORD"
    print_access
    exit 1
  fi

  local wired
  wired=$(kubectl -n "$ns" get cm "$(fullname)" -o jsonpath='{.data.console\.yaml}')
  if printf '%s' "$wired" | grep -q 'prefix: "/api/deploy"'; then
    r=$(api GET /api/deploy/session)
    if [ "$(code "$r")" = 200 ]; then
      if [ "$(body "$r" | pyjson 'print(d.get("initialized", False))')" = True ]; then ok "模型部署：swissd 可达，已有站点配置"
      else warn "模型部署：swissd 可达，还没有站点配置（打开 模型部署 完成设置）"; fi
      r=$(api GET /api/deploy/catalog)
      if [ "$(code "$r")" = 200 ]; then ok "模型目录：$(body "$r" | pyjson 'print(d["index"]["count"])') 个模型"
      else warn "模型目录：HTTP $(code "$r") $(body "$r" | head -c 200)"; fi
    else
      fail "模型部署：HTTP $(code "$r") $(body "$r" | head -c 200)"; failed=1
    fi
  else
    warn "模型部署：没有接 swissd"
  fi

  local models=""
  for _ in 1 2 3 4 5 6; do
    r=$(api GET /api/llm/v1/models)
    [ "$(code "$r")" = 200 ] && break
    sleep 5
  done
  if [ "$(code "$r")" = 200 ]; then
    models=$(body "$r" | pyjson 'print(" ".join(m["id"] for m in d.get("data", [])))')
    if [ -n "$models" ]; then ok "Playground 模型：$models"; else warn "Playground：网关上还没有模型"; fi
  else
    fail "Playground：HTTP $(code "$r") $(body "$r" | head -c 300)"; failed=1
  fi

  if [ -n "$models" ] && [ "$skip_chat" = 0 ]; then
    local m=${models%% *}
    r=$(api POST /api/llm/v1/chat/completions "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"max_tokens\":32}")
    if [ "$(code "$r")" = 200 ]; then
      ok "对话 $m：$(body "$r" | pyjson 'c=d["choices"][0]["message"]; t=(c.get("content") or c.get("reasoning_content") or "").strip().replace("\n"," "); print("%s（%s tokens）" % (t[:40], d.get("usage",{}).get("total_tokens","?")))')"
    else
      fail "对话 $m：HTTP $(code "$r") $(body "$r" | head -c 300)"; failed=1
    fi
  fi

  print_access
  [ "$failed" = 0 ] || exit 1
}

print_access() {
  step "访问"
  local svc type port ip
  svc=$(fullname)
  type=$(kubectl -n "$ns" get svc "$svc" -o jsonpath='{.spec.type}')
  if [ "$type" = NodePort ]; then
    port=$(kubectl -n "$ns" get svc "$svc" -o jsonpath='{.spec.ports[0].nodePort}')
    ip=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    echo "    http://$ip:$port/"
  else
    echo "    kubectl -n $ns port-forward svc/$svc 8080:8080   # 然后打开 http://localhost:8080/"
  fi
  echo "    用户 $admin_user"
}

release_admin() { # the admin this release was installed with, unless --admin-username says otherwise
  [ "$admin_user_given" = 1 ] && return 0
  local u
  u=$(helm -n "$ns" get values "$release" -a -o json 2>/dev/null | pyjson 'print(d.get("admin", {}).get("username") or "")' 2>/dev/null) || true
  [ -n "$u" ] && admin_user=$u
  return 0
}

do_status() {
  preflight
  release_admin
  step "release"
  helm -n "$ns" status "$release" -o json 2>/dev/null | pyjson 'print("    revision %s, %s, %s" % (d["version"], d["info"]["status"], d["info"]["last_deployed"][:19]))' \
    || die "$ns 里没有 release $release"
  kubectl -n "$ns" get pods -l "app.kubernetes.io/instance=$release" -o wide | sed 's/^/    /'
  step "接线"
  kubectl -n "$ns" get cm "$(fullname)" -o jsonpath='{.data.console\.yaml}' | sed -n '/^backends:/,$p' | sed 's/^/    /'
  print_access
}

do_uninstall() {
  preflight
  helm -n "$ns" status "$release" >/dev/null 2>&1 || die "$ns 里没有 release $release"
  release_admin
  local svc owner
  svc=$(fullname)
  owner=$(kubectl get users.iam.theriseunion.io "$admin_user" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/instance}' 2>/dev/null || true)
  if [ "$yes" = 0 ]; then
    read -r -p "卸载 $ns/$release？[y/N] " a
    case "$a" in y|Y|yes) ;; *) echo "已取消"; exit 0 ;; esac
  fi
  helm -n "$ns" uninstall "$release" --wait >/dev/null
  ok "已卸载 $release"
  [ "$owner" = "$release" ] && echo "    已删除：种子管理员 $admin_user"
  echo "    保留：iam CRD 和在界面上创建的用户/角色、$ns/$svc-api-keys（已签发的 API key）、$ns/$REGISTRY_SECRET_NAME、命名空间 $ns"
}

case "$cmd" in
  install) do_install ;;
  verify) do_verify ;;
  status) do_status ;;
  uninstall) do_uninstall ;;
esac
