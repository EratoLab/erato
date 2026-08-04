use axum::http::HeaderValue;

pub const POD_NAME_ENV: &str = "ERATO_POD_NAME";
pub const NODE_NAME_ENV: &str = "ERATO_NODE_NAME";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeploymentIdentity {
    pub pod_name: String,
    pub node_name: String,
}

impl DeploymentIdentity {
    pub fn from_env() -> Self {
        Self {
            pod_name: std::env::var(POD_NAME_ENV).unwrap_or_else(|_| "unknown-pod".to_string()),
            node_name: std::env::var(NODE_NAME_ENV).unwrap_or_else(|_| "unknown-node".to_string()),
        }
    }

    pub fn server_header(&self) -> HeaderValue {
        HeaderValue::from_str(&format!(
            "erato/{} pod={} node={}",
            env!("CARGO_PKG_VERSION"),
            self.pod_name,
            self.node_name
        ))
        .expect("Kubernetes pod and node names must produce a valid Server header")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_header_identifies_version_pod_and_node() {
        let identity = DeploymentIdentity {
            pod_name: "erato-app-abc".to_string(),
            node_name: "worker-1".to_string(),
        };

        assert_eq!(
            identity.server_header().to_str().unwrap(),
            format!(
                "erato/{} pod=erato-app-abc node=worker-1",
                env!("CARGO_PKG_VERSION")
            )
        );
    }
}
