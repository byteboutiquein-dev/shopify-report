export const AUTH_COOKIE_NAME = "kuviyal_tracking_session";

export function getAuthConfig() {
  const sessionSecret = process.env.APP_SESSION_SECRET;

  if (process.env.NODE_ENV === "production" && !sessionSecret) {
    throw new Error("APP_SESSION_SECRET is required in production.");
  }

  return {
    password: process.env.APP_PASSWORD ?? "admin",
    sessionSecret: sessionSecret ?? "kuviyal-local-session-secret",
    username: process.env.APP_USERNAME ?? "admin"
  };
}

export function isValidSessionToken(token: string | undefined) {
  return Boolean(token && token === getAuthConfig().sessionSecret);
}
