# erato

![Version: 0.5.1](https://img.shields.io/badge/Version-0.5.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.5.1](https://img.shields.io/badge/AppVersion-0.5.1-informational?style=flat-square)

Helm chart for the Erato chat application

## TL;DR

```bash
helm repo add erato https://eratolab.github.io/erato
helm install my-erato erato/erato
```

## Introduction

This chart bootstraps an [Erato](https://github.com/EratoLab/erato) deployment on a [Kubernetes](https://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

Erato is a chat application that provides a modern interface for AI-powered conversations.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8.0+
- PV provisioner support in the underlying infrastructure (if persistence is required)

## Installing the Chart

To install the chart with the release name `my-erato`:

```bash
helm install my-erato erato/erato
```

The command deploys Erato on the Kubernetes cluster with default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.

> **Tip**: List all releases using `helm list`

## Uninstalling the Chart

To uninstall/delete the `my-erato` deployment:

```bash
helm uninstall my-erato
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Configuration and Installation Details

### External PostgreSQL Database

The chart requires an external PostgreSQL database. Configure the connection using:

```yaml
postgresql:
  external:
    connectionString:
      value: "postgresql://user:password@hostname:5432/database"
```

For production deployments, it's recommended to use a secret:

```yaml
postgresql:
  external:
    connectionString:
      valueFrom:
        secretKeyRef:
          name: postgres-credentials
          key: connection-string
```

### Erato Configuration File

The application configuration can be provided in three ways:

1. **Using a Secret (Recommended for Production)**:

```yaml
backend:
  configFile:
    secretName: erato-config
    secretKey: erato.toml
```

2. **Using a ConfigMap**:

```yaml
backend:
  configFile:
    configMapName: erato-config
    configMapKey: erato.toml
```

3. **Inline Configuration**:

```yaml
backend:
  configFile:
    inlineContent: |
      [server]
      host = "0.0.0.0"
      port = 8080
```

### Additional Configuration Files

You can mount additional configuration files (e.g., `*.auto.erato.toml` files) using the `backend.extraConfigFiles` array:

```yaml
backend:
  extraConfigFiles:
    - name: mcp-servers
      secretName: mcp-config-secret
      secretKey: mcp-servers.toml
    - name: custom-settings
      inlineContent: |
        [custom]
        setting = "value"
```

### OAuth2 Proxy

The chart includes an optional OAuth2 Proxy for authentication. To enable it:

```yaml
oauth2Proxy:
  enabled: true
  config: |
    http_address = "0.0.0.0:4180"
    upstreams = ["http://localhost:8080"]
    email_domains = ["example.com"]
    cookie_secret = "your-secret-here"
```

### Ingress Configuration

To expose Erato externally, configure the ingress:

```yaml
ingress:
  enabled: true
  host: chat.example.com
  className: nginx
  tls:
    enabled: true
    secretName: erato-tls
```

## Requirements

| Repository | Name | Version |
|------------|------|---------|
| oci://registry-1.docker.io/bitnamicharts | common | 2.30.0 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| backend.configFile.configMapKey | string | `""` | Key in the configMap that contains the erato.toml content |
| backend.configFile.configMapName | string | `""` | Name of the configMap containing the erato.toml file (alternative to secretName/secretKey) |
| backend.configFile.inlineContent | string | `""` | Inline content for erato.toml (alternative to secret/configMap) |
| backend.configFile.secretKey | string | `""` | Key in the secret that contains the erato.toml content |
| backend.configFile.secretName | string | `""` | Name of the secret containing the erato.toml file |
| backend.deploymentAnnotations | object | `{}` | Annotations to add to the backend deployment |
| backend.deploymentStrategy | object | `{}` | Optional deployment strategy for backend rollout (e.g., RollingUpdate/Recreate). Example: deploymentStrategy:   type: RollingUpdate   rollingUpdate:     maxUnavailable: 25%     maxSurge: 25% |
| backend.deploymentVersion | string | `""` | Optional deployment version for cache headers on static files (falls back to image tag if not set) |
| backend.envSecrets | list | `[]` | Array of secret names to load as environment variables |
| backend.extraConfigFiles | list | `[]` | Optional list of additional config files to mount (e.g., *.auto.erato.toml files) Example: extraConfigFiles:   - name: mcp-servers     secretName: mcp-config-secret     secretKey: mcp-servers.toml   - name: additional-config     configMapName: additional-config-cm     configMapKey: additional.toml   - name: inline-config     inlineContent: |       [mcp_servers.example]       ... |
| backend.extraEnvVars | list | `[]` | Array with extra environment variables to add to backend |
| backend.extraEnvVarsCM | string | `""` | Name of existing ConfigMap containing extra env vars for backend |
| backend.extraEnvVarsSecret | string | `""` | Name of existing Secret containing extra env vars for backend |
| backend.extraVolumeMounts | list | `[]` | Optionally specify extra list of additional volumeMounts for the backend container |
| backend.extraVolumes | list | `[]` | Optionally specify extra list of additional volumes for the backend pod |
| backend.image.pullPolicy | string | `"IfNotPresent"` | Backend image pull policy |
| backend.image.pullSecrets | list | `[]` | Backend image pull secrets |
| backend.image.repository | string | `"harbor.imassage.me/erato/app"` | Backend image repository |
| backend.image.tag | string | `""` | Backend image tag (immutable tags are recommended) |
| backend.metrics.configFile.enabled | bool | `true` | Render and mount an additional `*.auto.erato.toml` config file that enables `integrations.prometheus`. |
| backend.metrics.enabled | bool | `false` | Enable backend Prometheus metrics integration and related chart resources. |
| backend.metrics.host | string | `"0.0.0.0"` | Host to bind the backend metrics listener to. |
| backend.metrics.port | int | `3131` | Port for backend metrics listener. |
| backend.metrics.service.addPrometheusAnnotations | bool | `true` | Add standard `prometheus.io/*` scrape annotations to the metrics Service. |
| backend.metrics.service.annotations | object | `{}` | Additional annotations for metrics Service. |
| backend.metrics.service.enabled | bool | `false` | Create a dedicated Service for the backend metrics endpoint. |
| backend.metrics.service.labels | object | `{}` | Additional labels for metrics Service. |
| backend.metrics.service.port | int | `3131` | Metrics Service port. |
| backend.metrics.service.type | string | `"ClusterIP"` | Metrics Service type. |
| backend.metrics.serviceMonitor.enabled | bool | `false` | Create a ServiceMonitor resource for Prometheus Operator. |
| backend.metrics.serviceMonitor.honorLabels | bool | `false` | Whether to honor labels from scraped metrics. |
| backend.metrics.serviceMonitor.interval | string | `"30s"` | Scrape interval for ServiceMonitor endpoint. |
| backend.metrics.serviceMonitor.labels | object | `{}` | Additional labels for ServiceMonitor (for Prometheus selection). |
| backend.metrics.serviceMonitor.metricRelabelings | list | `[]` | Metric relabel configs for ServiceMonitor endpoint. |
| backend.metrics.serviceMonitor.namespace | string | `""` | Namespace for ServiceMonitor. Defaults to the release namespace when empty. |
| backend.metrics.serviceMonitor.relabelings | list | `[]` | Relabel configs for ServiceMonitor endpoint. |
| backend.metrics.serviceMonitor.scrapeTimeout | string | `""` | Optional scrape timeout for ServiceMonitor endpoint. |
| backend.podAnnotations | object | `{}` | Annotations to add to the backend pod |
| backend.replicaCount | int | `1` | Number of backend replicas to deploy |
| backend.resources.limits.cpu | string | `"500m"` | The CPU limit for backend |
| backend.resources.limits.memory | string | `"512Mi"` | The memory limit for backend |
| backend.resources.requests.cpu | string | `"100m"` | The requested CPU for backend |
| backend.resources.requests.memory | string | `"128Mi"` | The requested memory for backend |
| backend.service.port | int | `8080` | Backend service HTTP port |
| backend.service.type | string | `"ClusterIP"` | Backend service type |
| commonAnnotations | object | `{}` | Annotations to add to all deployed objects |
| commonLabels | object | `{}` | Labels to add to all deployed objects |
| global.environment | string | `"production"` | Environment marker for diagnostic/observability tools (not parsed by application) |
| global.imagePullSecrets | list | `[]` | Global Docker registry secret names as an array |
| ingress.annotations | object | `{}` | Additional annotations for the Ingress resource |
| ingress.className | string | `"nginx"` | IngressClass that will be used to implement the Ingress |
| ingress.enabled | bool | `true` | Enable ingress record generation for Erato |
| ingress.extraPaths | list | `[]` | Additional paths to add to the ingress (e.g., for custom services) Example: extraPaths:   - path: /custom-path     pathType: Prefix     backend:       service:         name: my-service         port:           name: http |
| ingress.host | string | `"app.erato.internal"` | Default host for the ingress record |
| ingress.tls.enabled | bool | `false` | Enable TLS configuration for the host defined at ingress.host |
| ingress.tls.secretName | string | `""` | Secret containing TLS certificate |
| nameOverride | string | `""` | String to partially override common.names.fullname |
| oauth2Proxy.config | string | `"# Example configuration - replace with your own\n# http_address = \"0.0.0.0:4180\"\n# upstreams = [\"http://localhost:8080\"]\n# email_domains = [\"*\"]\n# cookie_secret = \"\"\n# cookie_secure = true\n# skip_auth_regex = [\"^/health\", \"^/metrics\"]\n"` | Full configuration file content for oauth2-proxy |
| oauth2Proxy.deploymentAnnotations | object | `{}` | Annotations to add to the oauth2-proxy deployment |
| oauth2Proxy.deploymentStrategy | object | `{}` | Optional deployment strategy for oauth2-proxy (e.g., RollingUpdate/Recreate). Example: deploymentStrategy:   type: RollingUpdate   rollingUpdate:     maxUnavailable: 25%     maxSurge: 25% |
| oauth2Proxy.enabled | bool | `true` | Enable OAuth2 Proxy for authentication |
| oauth2Proxy.extraEnvVars | list | `[]` | Array with extra environment variables to add to oauth2-proxy |
| oauth2Proxy.extraEnvVarsCM | string | `""` | Name of existing ConfigMap containing extra env vars for oauth2-proxy |
| oauth2Proxy.extraEnvVarsSecret | string | `""` | Name of existing Secret containing extra env vars for oauth2-proxy |
| oauth2Proxy.extraVolumeMounts | list | `[]` | Optionally specify extra list of additional volumeMounts for the oauth2-proxy container |
| oauth2Proxy.extraVolumes | list | `[]` | Optionally specify extra list of additional volumes for the oauth2-proxy pod |
| oauth2Proxy.image.pullPolicy | string | `"IfNotPresent"` | OAuth2 Proxy image pull policy |
| oauth2Proxy.image.pullSecrets | list | `[]` | OAuth2 Proxy image pull secrets |
| oauth2Proxy.image.repository | string | `"quay.io/oauth2-proxy/oauth2-proxy"` | OAuth2 Proxy image repository |
| oauth2Proxy.image.tag | string | `"v7.8.1"` | OAuth2 Proxy image tag |
| oauth2Proxy.metrics.enabled | bool | `false` | Enable oauth2-proxy metrics exposure resources. |
| oauth2Proxy.metrics.port | int | `44180` | oauth2-proxy metrics listener port. Must match oauth2-proxy config (e.g. metrics_address). |
| oauth2Proxy.metrics.service.addPrometheusAnnotations | bool | `true` | Add standard `prometheus.io/*` scrape annotations to the metrics Service. |
| oauth2Proxy.metrics.service.annotations | object | `{}` | Additional annotations for metrics Service. |
| oauth2Proxy.metrics.service.enabled | bool | `false` | Create a dedicated Service for the oauth2-proxy metrics endpoint. |
| oauth2Proxy.metrics.service.labels | object | `{}` | Additional labels for metrics Service. |
| oauth2Proxy.metrics.service.port | int | `44180` | Metrics Service port. |
| oauth2Proxy.metrics.service.type | string | `"ClusterIP"` | Metrics Service type. |
| oauth2Proxy.metrics.serviceMonitor.enabled | bool | `false` | Create a ServiceMonitor resource for Prometheus Operator. |
| oauth2Proxy.metrics.serviceMonitor.honorLabels | bool | `false` | Whether to honor labels from scraped metrics. |
| oauth2Proxy.metrics.serviceMonitor.interval | string | `"30s"` | Scrape interval for ServiceMonitor endpoint. |
| oauth2Proxy.metrics.serviceMonitor.labels | object | `{}` | Additional labels for ServiceMonitor (for Prometheus selection). |
| oauth2Proxy.metrics.serviceMonitor.metricRelabelings | list | `[]` | Metric relabel configs for ServiceMonitor endpoint. |
| oauth2Proxy.metrics.serviceMonitor.namespace | string | `""` | Namespace for ServiceMonitor. Defaults to the release namespace when empty. |
| oauth2Proxy.metrics.serviceMonitor.relabelings | list | `[]` | Relabel configs for ServiceMonitor endpoint. |
| oauth2Proxy.metrics.serviceMonitor.scrapeTimeout | string | `""` | Optional scrape timeout for ServiceMonitor endpoint. |
| oauth2Proxy.podAnnotations | object | `{}` | Annotations to add to the oauth2-proxy pod |
| oauth2Proxy.redis.enabled | bool | `true` | Enable Redis for OAuth2 Proxy session storage |
| oauth2Proxy.redis.image.pullPolicy | string | `"IfNotPresent"` | Redis image pull policy |
| oauth2Proxy.redis.image.repository | string | `"redis"` | Redis image repository |
| oauth2Proxy.redis.image.tag | string | `"7.0-alpine"` | Redis image tag |
| oauth2Proxy.redis.persistence.accessModes | list | `["ReadWriteOnce"]` | Persistent Volume access modes |
| oauth2Proxy.redis.persistence.enabled | bool | `true` | Enable persistence using Persistent Volume Claims |
| oauth2Proxy.redis.persistence.size | string | `"1Gi"` | Persistent Volume size |
| oauth2Proxy.redis.resources.limits.cpu | string | `"100m"` | The CPU limit for Redis |
| oauth2Proxy.redis.resources.limits.memory | string | `"128Mi"` | The memory limit for Redis |
| oauth2Proxy.redis.resources.requests.cpu | string | `"10m"` | The requested CPU for Redis |
| oauth2Proxy.redis.resources.requests.memory | string | `"32Mi"` | The requested memory for Redis |
| oauth2Proxy.resources.limits.cpu | string | `"500m"` | The CPU limit for oauth2-proxy |
| oauth2Proxy.resources.limits.memory | string | `"256Mi"` | The memory limit for oauth2-proxy |
| oauth2Proxy.resources.requests.cpu | string | `"100m"` | The requested CPU for oauth2-proxy |
| oauth2Proxy.resources.requests.memory | string | `"128Mi"` | The requested memory for oauth2-proxy |
| postgresql.enabled | bool | `false` | Deprecated - has no effect. Support for postgresql sub-chart has been removed. |
| postgresql.external.connectionString | object | `{"value":"postgresql://postgres:postgres@localhost:5432/postgres"}` | PostgreSQL connection string (plain value) |

## Troubleshooting

### Database Connection Issues

If you're experiencing database connection issues, verify:

1. The connection string is correct and accessible from the cluster
2. Network policies allow traffic to the database
3. The database user has appropriate permissions

### OAuth2 Proxy Configuration

If authentication isn't working:

1. Check the OAuth2 Proxy logs: `kubectl logs -l app.kubernetes.io/component=oauth2-proxy`
2. Verify the cookie secret is properly configured
3. Ensure redirect URIs are correctly registered with your OAuth provider

## Upgrading

### To 0.5.0

This version removed the embedded PostgreSQL subchart. You must now provide an external PostgreSQL database connection string.

## Maintainers

| Name | Email | Url |
| ---- | ------ | --- |
| Erato Team |  |  |

---

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
