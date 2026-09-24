//! Startup representation of every artifact distributed by the backend.
//!
//! Distribution modules own filesystem layout, discovery, and validation.
//! Server modules are deliberately limited to selecting and serving artifacts
//! from these concrete descriptions.

use std::sync::Arc;

use crate::config::AppConfig;

pub mod component_kits;
pub mod desktop_sidecar;
pub mod experience_policy;
pub mod frontend_bundles;
pub mod runtime;
pub mod teams;
pub mod translations;

use component_kits::ComponentKitDistribution;
use desktop_sidecar::DesktopSidecarDistribution;
use frontend_bundles::FrontendBundles;
use teams::TeamsAppDistribution;
use translations::TranslationDistribution;

/// The complete set of artifacts available to one Erato process.
#[derive(Clone, Debug)]
pub struct Distribution {
    pub frontend_bundles: FrontendBundles,
    pub component_kits: ComponentKitDistribution,
    pub translations: TranslationDistribution,
    pub desktop_sidecar: Option<Arc<DesktopSidecarDistribution>>,
    pub teams_app: Option<Arc<TeamsAppDistribution>>,
}

impl Distribution {
    #[must_use]
    pub fn load(config: &AppConfig) -> Self {
        let frontend_bundles = FrontendBundles::from_config(config);
        let component_kits =
            ComponentKitDistribution::discover(config.frontend.component_kits.directory.clone());
        let translations =
            TranslationDistribution::discover(config, &frontend_bundles, &component_kits);
        let desktop_sidecar = load_desktop_sidecar(config);
        let teams_app = load_teams_app(config);

        Self {
            frontend_bundles,
            component_kits,
            translations,
            desktop_sidecar,
            teams_app,
        }
    }
}

fn load_teams_app(config: &AppConfig) -> Option<Arc<TeamsAppDistribution>> {
    if !config.integrations.ms_office.teams.enabled {
        return None;
    }
    match TeamsAppDistribution::load(&config.integrations.ms_office.addin.frontend_bundle_path) {
        Ok(distribution) => Some(Arc::new(distribution)),
        Err(error) => {
            tracing::error!(%error, "Teams app distribution is enabled but could not be loaded");
            None
        }
    }
}

fn load_desktop_sidecar(config: &AppConfig) -> Option<Arc<DesktopSidecarDistribution>> {
    if !config.desktop_sidecar.distribution.enabled {
        return None;
    }

    match DesktopSidecarDistribution::load_with_config(
        &config.desktop_sidecar.distribution.directory,
        &config.desktop_sidecar,
    ) {
        Ok(distribution) => {
            tracing::info!(
                directory = %config.desktop_sidecar.distribution.directory,
                targets = distribution.targets().len(),
                "Loaded desktop sidecar distribution"
            );
            Some(Arc::new(distribution))
        }
        Err(error) => {
            tracing::error!(
                directory = %config.desktop_sidecar.distribution.directory,
                %error,
                "Desktop sidecar distribution is enabled but could not be loaded"
            );
            None
        }
    }
}
