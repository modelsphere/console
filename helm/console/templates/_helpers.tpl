{{- define "console.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "console.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "console.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "console.labels" -}}
app.kubernetes.io/name: {{ include "console.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "console.selectorLabels" -}}
app.kubernetes.io/name: {{ include "console.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "console.serviceAccountName" -}}
{{ include "console.fullname" . }}
{{- end -}}

{{- /* The swiss subchart's fullname, computed the way charts/swiss/templates/_helpers.tpl does. */ -}}
{{- define "console.swiss.fullname" -}}
{{- $v := .Values.swiss -}}
{{- if $v.fullnameOverride -}}
{{- $v.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default "swiss" $v.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "console.swiss.url" -}}
{{- printf "http://%s.%s.svc:%d/api" (include "console.swiss.fullname" .) .Release.Namespace (int .Values.swiss.service.port) -}}
{{- end -}}

{{- /* swiss's site profile, "namespace/name": swiss.config.cluster.profile or the one swissd creates. */ -}}
{{- define "console.swiss.profile" -}}
{{- if .Values.swiss.config.cluster.profile -}}
{{- .Values.swiss.config.cluster.profile -}}
{{- else -}}
{{- printf "%s/%s-profile" .Release.Namespace (include "console.swiss.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- /* The site profile the gateway is resolved from: the one named, else the bundled swissd's. */ -}}
{{- define "console.gateway.profile" -}}
{{- $gw := .Values.playground.gateway -}}
{{- if $gw.profile -}}
{{- $gw.profile -}}
{{- else if and .Values.swiss.enabled $gw.fromSwiss (not $gw.configMap) -}}
{{- include "console.swiss.profile" . -}}
{{- end -}}
{{- end -}}

{{- /* An existing gateway named in playground.gateway wins over the built-in one. */ -}}
{{- define "console.gateway.external" -}}
{{- if or (include "console.gateway.profile" .) .Values.playground.gateway.configMap -}}true{{- end -}}
{{- end -}}

{{- define "console.gateway.builtin" -}}
{{- if and .Values.gateway.enabled (not (include "console.gateway.external" .)) -}}true{{- end -}}
{{- end -}}

{{- define "console.gateway.name" -}}
{{ include "console.fullname" . }}-gateway
{{- end -}}

{{- /* The router needs a gateway: /v1 has nowhere else to go. */ -}}
{{- define "console.router.enabled" -}}
{{- if and .Values.router.enabled (or (include "console.gateway.external" .) (include "console.gateway.builtin" .)) -}}true{{- end -}}
{{- end -}}

{{- /* Models the built-in gateway serves: the demo model, then gateway.models. */ -}}
{{- define "console.gateway.models" -}}
{{- $models := list -}}
{{- if .Values.demo.enabled -}}
{{-   $models = append $models (dict "name" .Values.demo.model.name "url" (printf "http://%s-demo.%s.svc.cluster.local:%d" (include "console.fullname" .) .Release.Namespace (int .Values.demo.port))) -}}
{{- end -}}
{{- range .Values.gateway.models -}}
{{-   $models = append $models . -}}
{{- end -}}
{{- toJson $models -}}
{{- end -}}

{{- /*
The one aggregate route. Peers must be IP literals, so each model gets a relay
server on loopback that proxies to its URL; nginx resolves that name once, at
load, through the pod's resolver. Model names are the ids clients send, and must
equal what the engine serves.
*/ -}}
{{- define "console.gateway.routeConf" -}}
{{- $r := .Values.gateway.route -}}
{{- $models := include "console.gateway.models" . | fromJsonArray -}}
lua_shared_dict active_conns_{{ $r }} 4m;
lua_shared_dict cluster_avg_{{ $r }} 16k;
lua_shared_dict lc_locks_{{ $r }} 1m;
lua_shared_dict bad_peers_{{ $r }} 1m;
lua_shared_dict bodylog_ctl_{{ $r }} 1m;
lua_shared_dict cch_ctl_{{ $r }} 1m;
{{- range $i, $m := $models }}
{{- if not (regexMatch "^[A-Za-z0-9._:/-]+$" $m.name) }}{{ fail (printf "gateway model name %q may only use letters, digits and ._:/-" $m.name) }}{{ end }}
{{- if not (regexMatch "^https?://[^ \t;{}\\\\]+$" $m.url) }}{{ fail (printf "gateway model %q: url %q must be http(s)://host:port[/path]" $m.name $m.url) }}{{ end }}

server {
    listen 127.0.0.1:{{ add 18001 $i }};
    location / {
        proxy_pass {{ trimSuffix "/" $m.url }}/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
{{- end }}

server {
    listen unix:/usr/local/openresty/nginx/sock/{{ $r }}.sock;
    server_name _;
    set $route "{{ $r }}";
    set_by_lua_block $__{{ $r | replace "-" "_" | replace "." "_" }}_init {
        _G.register_route("{{ $r }}", function() return {
            peers_by_model = {
{{- range $i, $m := $models }}
                ["{{ $m.name }}"] = { {"127.0.0.1", {{ add 18001 $i }}, "{{ $m.name }}", 0, {{ $.Values.gateway.maxConcurrency }}} },
{{- end }}
            },
            default_max = {{ .Values.gateway.maxConcurrency }},
            adaptive_cc = false,
        } end)
        return ""
    }
    include conf.d/router_locations.inc;
}
{{- end -}}

{{- define "console.router.secret" -}}
{{ include "console.fullname" . }}-api-keys
{{- end -}}

{{- /* Pods of a bundled component (gateway, demo model). Their own name keeps them
       out of console's selectors, which match name+instance only and cannot
       change on an existing release. */ -}}
{{- define "console.componentSelectorLabels" -}}
{{- $ctx := index . 0 -}}
app.kubernetes.io/name: {{ include "console.name" $ctx }}-{{ index . 1 }}
app.kubernetes.io/instance: {{ $ctx.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}
