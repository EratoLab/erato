/**
 * Shared token store for optional Bearer auth.
 *
 * The normal web app relies on cookie auth, so this stays null there.
 * Alternate shells such as the Office add-in can populate it.
 */
let idToken: string | null = null;

export function setIdToken(token: string | null) {
  idToken = token;
}

export function getIdToken(): string | null {
  return idToken;
}
