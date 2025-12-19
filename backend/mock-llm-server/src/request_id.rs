use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use rand::Rng;

/// Extension type to store the request ID
#[derive(Clone, Debug)]
pub struct RequestId(pub String);

impl RequestId {
    /// Generate a new random 8-character hexadecimal request ID
    pub fn generate() -> Self {
        let mut rng = rand::thread_rng();
        let id: u32 = rng.gen();
        RequestId(format!("{:08x}", id))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Middleware to add a request ID to each request
pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    let request_id = RequestId::generate();

    // Insert the request ID as an extension so handlers can access it
    request.extensions_mut().insert(request_id.clone());

    // Call the next middleware/handler
    let mut response = next.run(request).await;

    // Add the request ID to the response headers
    response.headers_mut().insert(
        "x-request-id",
        HeaderValue::from_str(&request_id.0)
            .unwrap_or_else(|_| HeaderValue::from_static("invalid")),
    );

    response
}
