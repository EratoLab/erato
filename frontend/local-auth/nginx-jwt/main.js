// JWT creation helper functions
function base64UrlEncode(str) {
  // Convert string to base64 and make it URL safe
  // In njs, we need to use Buffer.from() to convert string to buffer first
  // eslint-disable-next-line no-undef
  const buffer = Buffer.from(str, "utf8");
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function createJWT(payload, secret) {
  // Create JWT header (algorithm HS256)
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  // Convert header and payload to base64Url encoded strings
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  // Create the content to be signed
  const signatureContent = encodedHeader + "." + encodedPayload;

  // Create HMAC SHA256 signature using njs crypto
  const signature = require("crypto")
    .createHmac("sha256", secret)
    .update(signatureContent)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // Combine to form the complete JWT
  return signatureContent + "." + signature;
}

function generateJWTForUser(userValue, jwtSecret) {
  // Current timestamp in seconds (for iat and exp claims)
  const now = Math.floor(Date.now() / 1000);

  // Create JWT payload with claims that match what the backend expects
  const payload = {
    sub: userValue, // Subject (user identifier)
    preferred_username: userValue, // Username
    name: userValue, // Display name
    email: userValue + "@example.com", // Email (generated)
    iat: now, // Issued at time
    exp: now + 3600, // Expiration (1 hour from now)
    iss: "nginx-jwt-generator", // Issuer
    aud: "erato", // Audience
  };

  return createJWT(payload, jwtSecret);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(";").forEach((cookie) => {
      const parts = cookie.trim().split("=");
      if (parts.length === 2) {
        cookies[parts[0]] = decodeURIComponent(parts[1]);
      }
    });
  }
  return cookies;
}

function handleRequest(r) {
  // JWT secret key - should be stored securely
  const jwtSecret = "erato-nginx-jwt-secret-key-change-in-production";

  // Extract user value from URL parameter
  const userValue = r.args.user;

  // Parse cookies from the request
  const cookies = parseCookies(r.headersIn["Cookie"]);
  const authCookie = cookies["erato-auth-user"];

  let currentUser = null;
  let shouldSetCookie = false;

  if (userValue) {
    // User parameter provided - this is a login request
    currentUser = userValue;
    shouldSetCookie = true;
    r.log("User login via URL parameter: " + userValue);
  } else if (authCookie) {
    // No user parameter, but we have an auth cookie
    currentUser = authCookie;
    r.log("User authenticated via cookie: " + authCookie);
  }

  if (currentUser) {
    try {
      // Generate the JWT for the current user
      const jwt = generateJWTForUser(currentUser, jwtSecret);

      // Set JWT in a variable that can be used by nginx proxy
      r.variables.auth_jwt = "Bearer " + jwt;

      // Set authentication cookie if this is a new login
      if (shouldSetCookie) {
        // Set cookie that expires in 1 hour (same as JWT)
        const cookieValue = `erato-auth-user=${encodeURIComponent(currentUser)}; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax`;
        r.headersOut["Set-Cookie"] = cookieValue;
      }
    } catch (e) {
      r.error("Failed to generate JWT: " + e.message);
      r.return(500, "Internal Server Error");
      return;
    }

    // Create a new URI without the user parameter (if it was present)
    let newArgs = "";
    for (let param in r.args) {
      if (param !== "user") {
        if (newArgs) newArgs += "&";
        newArgs += param + "=" + encodeURIComponent(r.args[param]);
      }
    }

    // Determine which upstream to use based on the path
    let targetLocation = "@frontend";
    if (r.uri.startsWith("/api/")) {
      targetLocation = "@backend";
    }

    // Forward to appropriate upstream with cleaned URL
    const newUri = r.uri + (newArgs ? "?" + newArgs : "");
    r.internalRedirect(targetLocation, newUri);
  } else {
    // No user parameter and no valid cookie - check for existing Authorization header
    const authHeader = r.headersIn["Authorization"];

    if (authHeader) {
      // Existing auth header, forward as-is
      r.variables.auth_jwt = authHeader;

      let targetLocation = "@frontend";
      if (r.uri.startsWith("/api/")) {
        targetLocation = "@backend";
      }
      r.internalRedirect(targetLocation);
    } else {
      // No authentication provided
      r.return(401, "Authentication required. Add ?user=<username> to the URL");
      return;
    }
  }
}

function handleLogout(r) {
  // Clear the authentication cookie
  r.headersOut["Set-Cookie"] =
    "erato-auth-user=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";

  // Redirect to home page
  r.return(302, "/");
}

export default { handleRequest, handleLogout };
