export async function register() {
  const { securityConfig } = await import("./lib/security-config");
  securityConfig();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loginIdentifierKey } = await import("./lib/login-identity");
    loginIdentifierKey();
  }
}
