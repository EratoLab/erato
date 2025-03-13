{{/*
Renders a value that contains template perhaps with scope if the scope is present.
Usage:
{{ include "common.tplvalues.render" ( dict "value" .Values.path.to.the.Value "context" $ ) }}
{{ include "common.tplvalues.render" ( dict "value" .Values.path.to.the.Value "context" $ "scope" $app ) }}
*/}}
{{- define "common.tplvalues.render" -}}
{{- $value := typeIs "string" .value | ternary .value (.value | toYaml) }}
{{- if contains "{{" (toJson .value) }}
  {{- if .scope }}
      {{- tpl (cat "{{- with $.RelativeScope -}}" $value "{{- end }}") (merge (dict "RelativeScope" .scope) .context) }}
  {{- else }}
    {{- tpl $value .context }}
  {{- end }}
{{- else }}
    {{- $value }}
{{- end }}
{{- end -}}

{{/*
Return the proper Docker Image Registry Secret Names evaluating values as templates
{{ include "common.images.renderPullSecrets" ( dict "images" (list .Values.path.to.the.image1, .Values.path.to.the.image2) "context" $) }}
*/}}
{{- define "common.images.renderPullSecrets" -}}
  {{- $pullSecrets := list }}
  {{- $context := .context }}

  {{- range (($context.Values.global).imagePullSecrets) -}}
    {{- if kindIs "map" . -}}
      {{- $pullSecrets = append $pullSecrets (include "common.tplvalues.render" (dict "value" .name "context" $context)) -}}
    {{- else -}}
      {{- $pullSecrets = append $pullSecrets (include "common.tplvalues.render" (dict "value" . "context" $context)) -}}
    {{- end -}}
  {{- end -}}

  {{- range .images -}}
    {{- range .pullSecrets -}}
      {{- if kindIs "map" . -}}
        {{- $pullSecrets = append $pullSecrets (include "common.tplvalues.render" (dict "value" .name "context" $context)) -}}
      {{- else -}}
        {{- $pullSecrets = append $pullSecrets (include "common.tplvalues.render" (dict "value" . "context" $context)) -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}

  {{- if (not (empty $pullSecrets)) -}}
imagePullSecrets:
    {{- range $pullSecrets | uniq }}
  - name: {{ . }}
    {{- end }}
  {{- end }}
{{- end -}}

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