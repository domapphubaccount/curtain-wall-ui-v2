function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

export function validateEnvironment(): void {
  required("DATABASE_URL");
  const jwtSecret = required("JWT_SECRET");
  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  if (process.env.NODE_ENV === "production") {
    required("CORS_ORIGIN");
    if (process.env.COOKIE_SECURE !== "true") {
      console.warn("COOKIE_SECURE is not true; only use this for an HTTP-only private deployment");
    }
  }
}
