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