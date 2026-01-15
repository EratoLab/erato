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
    name: null, // Display name
    email: userValue + "@example.com", // Email (generated)
    iat: now, // Issued at time
    exp: now + {{ .Values.nginxAuth.jwtExpirationSeconds | default 3600 | int }}, // Expiration
    iss: "{{ .Values.nginxAuth.jwtIssuer | default `nginx-jwt-generator` }}", // Issuer
    aud: "{{ .Values.nginxAuth.jwtAudience | default `erato` }}", // Audience
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

function generateAuthToken(userValue) {
  // Generate a simple token that can be used for subsequent requests
  const timestamp = Date.now();
  const tokenData = {
    user: userValue,
    timestamp: timestamp,
    expires: timestamp + ({{ .Values.nginxAuth.jwtExpirationSeconds | default 2592000 | int }} * 1000)
  };
  return btoa(JSON.stringify(tokenData));
}

function parseAuthToken(token) {
  try {
    const tokenData = JSON.parse(atob(token));
    if (tokenData.expires > Date.now()) {
      return tokenData.user;
    }
  } catch (e) {
    // Invalid token
  }
  return null;
}

function handleRequest(r) {
  // JWT secret key - should be stored securely
  const jwtSecret = "{{ .Values.nginxAuth.jwtSecret }}";

  // Extract user value from URL parameter
  const userValue = r.args.user;
  
  // Extract auth token from URL parameter (for iframe-compatible auth)
  const authToken = r.args.authToken;

  // Parse cookies from the request (fallback for non-iframe usage)
  const cookies = parseCookies(r.headersIn["Cookie"]);
  const authCookie = cookies["{{ .Values.nginxAuth.cookieName | default `typo3-auth-user` }}"];

  let currentUser = null;
  let shouldSetCookie = false;
  let shouldReturnAuthToken = false;

  if (userValue) {
    // User parameter provided - this is a login request
    currentUser = userValue;
    shouldSetCookie = true;
    shouldReturnAuthToken = true;
    r.log("User login via URL parameter: " + userValue);
  } else if (authToken) {
    // Auth token provided - validate it
    currentUser = parseAuthToken(authToken);
    if (currentUser) {
      r.log("User authenticated via auth token: " + currentUser);
    }
  } else if (authCookie) {
    // No user parameter, but we have an auth cookie (fallback)
    currentUser = authCookie;
    r.log("User authenticated via cookie: " + authCookie);
  }

  if (currentUser) {
    try {
      // Generate the JWT for the current user
      const jwt = generateJWTForUser(currentUser, jwtSecret);

      // Set JWT in a variable that can be used by nginx proxy
      r.variables.auth_jwt = "Bearer " + jwt;

      // Set authentication cookie if this is a new login (for non-iframe usage)
      if (shouldSetCookie) {
        // Set cookie that expires in same time as JWT
            const cookieValue = "{{ .Values.nginxAuth.cookieName | default `typo3-auth-user` }}=" + encodeURIComponent(currentUser) + "; Max-Age={{ .Values.nginxAuth.jwtExpirationSeconds | default 2592000 | int }}; Path=/; HttpOnly; SameSite={{ .Values.nginxAuth.cookieSameSite | default `None` }}; Secure";
        r.headersOut["Set-Cookie"] = cookieValue;
      }

      // For iframe usage, store token and redirect to clean URL
      if (shouldReturnAuthToken) {
        const token = generateAuthToken(currentUser);
        const cleanUrl = r.uri;
        
        // Store the token in a way that persists for this session
        // We'll use a combination of sessionStorage and URL-based token passing
        const loginResponse = `
<!DOCTYPE html>
<html>
<head>
    <title>Authentication</title>
    <script>
        // Store auth token in sessionStorage for iframe-compatible usage
        sessionStorage.setItem('erato-auth-token', '${token}');
        
        // Immediately redirect to clean URL with token in hash (doesn't cause server request)
        window.location.href = '${cleanUrl}#auth=' + encodeURIComponent('${token}');
    </script>
</head>
<body>
    <p>Authenticating...</p>
</body>
</html>`;
        r.headersOut["Content-Type"] = "text/html";
        r.return(200, loginResponse);
        return;
      }
    } catch (e) {
      r.error("Failed to generate JWT: " + e.message);
      r.return(500, "Internal Server Error");
      return;
    }

    // Create a new URI without the user and authToken parameters
    let newArgs = "";
    for (let param in r.args) {
      if (param !== "user" && param !== "authToken") {
        if (newArgs) newArgs += "&";
        newArgs += param + "=" + encodeURIComponent(r.args[param]);
      }
    }

    // Forward to erato app with cleaned URL
    const newUri = r.uri + (newArgs ? "?" + newArgs : "");
    r.internalRedirect("@erato_app", newUri);
  } else {
    // No user parameter and no valid cookie - check for existing Authorization header
    const authHeader = r.headersIn["Authorization"];

    if (authHeader) {
      // Existing auth header, forward as-is
      r.variables.auth_jwt = authHeader;
      r.internalRedirect("@erato_app");
    } else {
      // No authentication provided - return auto-authenticating HTML
      const userAgent = r.headersIn["User-Agent"] || "";
      const isLikelyBrowser = userAgent.includes("Mozilla") || userAgent.includes("Chrome") || userAgent.includes("Safari");
      
      if (isLikelyBrowser) {
        // Return HTML that automatically handles auth token detection and retry
        const authBootstrapResponse = `
<!DOCTYPE html>
<html>
<head>
    <title>Loading...</title>
    <script>
        (function() {
            // Check multiple sources for auth token
            let authToken = null;
            
            // 1. Check URL hash fragment
            const hash = window.location.hash;
            if (hash.startsWith('#auth=')) {
                authToken = decodeURIComponent(hash.substring(6));
                // Clean up the hash
                history.replaceState(null, null, window.location.pathname + window.location.search);
            }
            
            // 2. Check sessionStorage
            if (!authToken) {
                authToken = sessionStorage.getItem('erato-auth-token');
            }
            
            // 3. Validate token if found
            if (authToken) {
                try {
                    const tokenData = JSON.parse(atob(authToken));
                    if (tokenData.expires > Date.now()) {
                        // Valid token - reload with it
                        sessionStorage.setItem('erato-auth-token', authToken);
                        const url = new URL(window.location);
                        url.searchParams.set('authToken', authToken);
                        window.location.replace(url.toString());
                        return;
                    } else {
                        // Expired token
                        sessionStorage.removeItem('erato-auth-token');
                    }
                } catch (e) {
                    // Invalid token
                    sessionStorage.removeItem('erato-auth-token');
                }
            }
            
            // No valid token found - show auth required
            document.body.innerHTML = 
                '<div style="padding: 20px; font-family: Arial, sans-serif; text-align: center;">' +
                    '<h2>Authentication Required</h2>' +
                    '<p>To access this content, add <code>?user=&lt;username&gt;</code> to the URL</p>' +
                    '<p><small>This content is displayed in an iframe-compatible way.</small></p>' +
                '</div>';
        })();
    </script>
</head>
<body>
    <div style="padding: 20px; text-align: center;">
        <p>Checking authentication...</p>
    </div>
</body>
</html>`;
        r.headersOut["Content-Type"] = "text/html";
        r.return(200, authBootstrapResponse);
        return;
      } else {
        r.return(401, "Authentication required. Add ?user=<username> to the URL");
        return;
      }
    }
  }
}

function handleLogout(r) {
  // Return JavaScript that clears authentication and redirects
  const logoutResponse = `
<!DOCTYPE html>
<html>
<head>
    <title>Logout</title>
    <script>
        // Clear sessionStorage
        sessionStorage.removeItem('erato-auth-token');
        
        // Redirect to home page immediately
        window.location.replace('/');
    </script>
</head>
<body>
    <div style="padding: 20px; text-align: center; font-family: Arial, sans-serif;">
        <h2>Logged Out</h2>
        <p>Redirecting...</p>
    </div>
</body>
</html>`;

  // Also clear the authentication cookie
  r.headersOut["Set-Cookie"] =
    "{{ .Values.nginxAuth.cookieName | default `typo3-auth-user` }}=; Max-Age=0; Path=/; HttpOnly; SameSite={{ .Values.nginxAuth.cookieSameSite | default `None` }}; Secure";

  r.headersOut["Content-Type"] = "text/html";
  r.return(200, logoutResponse);
}

export default { handleRequest, handleLogout };
