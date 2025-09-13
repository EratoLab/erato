{{/*
Expand the name of the chart.
*/}}
{{- define "erato.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "erato.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart version number.
*/}}
{{- define "erato.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "erato.labels" -}}
helm.sh/chart: {{ include "erato.chart" . }}
{{ include "erato.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "erato.selectorLabels" -}}
app.kubernetes.io/name: {{ include "erato.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Return the Postgres value or valueFrom
*/}}
{{- define "erato.postgresValueOrValueFrom" -}}
{{- if .Values.postgresql.enabled }}
    {{- if .Values.global.postgresql }}
        {{- if .Values.global.postgresql.auth }}
value: {{ coalesce .Values.global.postgresql.auth.database .Values.postgresql.auth.database }}
        {{- else -}}
value: {{ .Values.postgresql.auth.database }}
        {{- end -}}
    {{- else -}}
value: {{ .Values.postgresql.auth.database }}
    {{- end -}}
{{- else -}}
    {{- if .Values.postgresql.external.connectionString.valueFrom -}}
valueFrom: {{- toYaml .Values.postgresql.external.connectionString.valueFrom | nindent 2 }}
    {{- else -}}
value: {{ .Values.postgresql.external.connectionString.value }}
    {{- end -}}
{{- end -}}
{{- end -}}


{{/*
Return the proper Docker Image Registry Secret Names
*/}}
{{- define "erato.imagePullSecrets" -}}
{{- include "common.images.renderPullSecrets" (dict "images" (list .Values.oauth2Proxy.image .Values.backend.image) "context" $) -}}
{{- end -}}

{{/*
Check if the main config file should be mounted
*/}}
{{- define "erato.hasMainConfigFile" -}}
{{- if or (and .Values.backend.configFile.secretName .Values.backend.configFile.secretKey) (and .Values.backend.configFile.configMapName .Values.backend.configFile.configMapKey) .Values.backend.configFile.inlineContent -}}
true
{{- end -}}
{{- end -}}

{{/*
Check if there are extra config files to mount
*/}}
{{- define "erato.hasExtraConfigFiles" -}}
{{- if .Values.backend.extraConfigFiles -}}
true
{{- end -}}
{{- end -}}

{{/*
Render the main config file volume
*/}}
{{- define "erato.renderMainConfigVolume" -}}
{{- if and .Values.backend.configFile.secretName .Values.backend.configFile.secretKey -}}
- name: erato-config
  secret:
    secretName: {{ .Values.backend.configFile.secretName }}
    items:
      - key: {{ .Values.backend.configFile.secretKey }}
        path: erato.toml
{{- else if and .Values.backend.configFile.configMapName .Values.backend.configFile.configMapKey -}}
- name: erato-config
  configMap:
    name: {{ .Values.backend.configFile.configMapName }}
    items:
      - key: {{ .Values.backend.configFile.configMapKey }}
        path: erato.toml
{{- else if .Values.backend.configFile.inlineContent -}}
- name: erato-config
  configMap:
    name: {{ .Release.Name }}-erato-inline-config
    items:
      - key: erato.toml
        path: erato.toml
{{- end -}}
{{- end -}}

{{/*
Render an extra config file volume
*/}}
{{- define "erato.renderExtraConfigVolume" -}}
{{- $configFile := .configFile -}}
{{- $index := .index -}}
{{- $context := .context -}}
{{- if and $configFile.secretName $configFile.secretKey -}}
- name: extra-config-{{ $configFile.name }}
  secret:
    secretName: {{ $configFile.secretName }}
    items:
      - key: {{ $configFile.secretKey }}
        path: {{ $configFile.name }}.auto.erato.toml
{{- else if and $configFile.configMapName $configFile.configMapKey -}}
- name: extra-config-{{ $configFile.name }}
  configMap:
    name: {{ $configFile.configMapName }}
    items:
      - key: {{ $configFile.configMapKey }}
        path: {{ $configFile.name }}.auto.erato.toml
{{- else if $configFile.inlineContent -}}
- name: extra-config-{{ $configFile.name }}
  configMap:
    name: {{ $context.Release.Name }}-extra-config-{{ $configFile.name }}-inline
    items:
      - key: {{ $configFile.name }}.toml
        path: {{ $configFile.name }}.auto.erato.toml
{{- end -}}
{{- end -}}