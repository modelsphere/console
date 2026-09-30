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

{{- /* playground.gateway names an existing gateway to resolve from the cluster. */ -}}
{{- define "console.gateway" -}}
{{- if or .Values.playground.gateway.profile .Values.playground.gateway.configMap -}}true{{- end -}}
{{- end -}}

{{- /* The router needs somewhere to send /v1: a gateway, or the demo model. */ -}}
{{- define "console.router.enabled" -}}
{{- if and .Values.router.enabled (or (include "console.gateway" .) .Values.demo.enabled) -}}true{{- end -}}
{{- end -}}

{{- define "console.router.secret" -}}
{{ include "console.fullname" . }}-api-keys
{{- end -}}

{{- /* Pods of a bundled component (the demo model). Their own name keeps them
       out of console's selectors, which match name+instance only and cannot
       change on an existing release. */ -}}
{{- define "console.componentSelectorLabels" -}}
{{- $ctx := index . 0 -}}
app.kubernetes.io/name: {{ include "console.name" $ctx }}-{{ index . 1 }}
app.kubernetes.io/instance: {{ $ctx.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}
