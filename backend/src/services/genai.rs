// use genai::{ModelIden, ServiceTarget};
// use genai::adapter::AdapterKind;
// use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
//
// pub fn build_genai_client() -> genai::Client {
//     let genai_client = genai::ClientBuilder::default().with_service_target_resolver(ServiceTargetResolver::from_resolver_fn(|_service_target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
//         let endpoint = Endpoint::from_static("http://localhost:12434/v1/");
//         let auth = AuthData::from_single("PLACEHOLDER");
//         let model = ModelIden::new(AdapterKind::Ollama, "smollm2:135m");
//         Ok(ServiceTarget { endpoint, auth, model })
//     },
//     )).build();
//     genai_client
// }
