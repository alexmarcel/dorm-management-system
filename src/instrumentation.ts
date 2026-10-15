export async function register() {
  const { securityConfig } = await import("./lib/security-config");
  securityConfig();
}
