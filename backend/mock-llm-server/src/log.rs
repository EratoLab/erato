use colored::Colorize;

/// Log a message with a request ID prefix and colored sections
pub fn log_request(request_id: &str, method: &str, path: &str, message: &str) {
    println!(
        "{} {} {} {}",
        format!("[{}]", request_id).green(),
        method.bright_cyan(),
        path.bright_yellow(),
        message
    );
}

/// Log a message with just a request ID prefix
pub fn log_with_id(request_id: &str, message: &str) {
    println!("{} {}", format!("[{}]", request_id).green(), message);
}

/// Log a 404 error
pub fn log_404(request_id: &str, method: &str, path: &str) {
    println!(
        "{} {} {} {}",
        format!("[{}]", request_id).green(),
        method.bright_cyan(),
        path.bright_yellow(),
        "404 Not Found".red()
    );
}

/// Log when starting to stream response
pub fn log_response_start(request_id: &str, response_type: &str) {
    println!(
        "{} {}",
        format!("[{}]", request_id).green(),
        format!("Starting {} response stream", response_type).bright_green()
    );
}

/// Log when response stream is complete
pub fn log_response_complete(request_id: &str) {
    println!(
        "{} {}",
        format!("[{}]", request_id).green(),
        "Response stream complete".bright_green()
    );
}

/// Log server startup information
pub fn log_startup(addr: &str) {
    println!("{}", "Mock LLM Server".bright_green().bold());
    println!("{} {}", "Listening on:".bright_white(), addr.bright_cyan());
    println!();
    println!("{}", "Available endpoints:".bright_white());
    println!("  {} {}", "GET".bright_cyan(), "/health".bright_yellow());
    println!(
        "  {} {}",
        "POST".bright_cyan(),
        "/base-openai/v1/chat/completions".bright_yellow()
    );
    println!(
        "  {} {}",
        "POST".bright_cyan(),
        "/base-openai/v1/embeddings".bright_yellow()
    );
    println!(
        "  {} {}",
        "POST".bright_cyan(),
        "/base-openai/v1/images/generations".bright_yellow()
    );
    println!();
}
