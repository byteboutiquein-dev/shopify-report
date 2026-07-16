import "server-only";

import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const shopDomain = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}, z.string().trim().min(1).optional());

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalNonEmpty.refine(
    (value) => !value || value.startsWith("https://"),
    "Supabase URL must start with https://"
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmpty,
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmpty,
  SHOPIFY_SHOP_DOMAIN: shopDomain.refine(
    (value) => !value || /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(value),
    "Shopify domain must look like store-name.myshopify.com"
  ),
  SHOPIFY_CLIENT_ID: optionalNonEmpty,
  SHOPIFY_CLIENT_SECRET: optionalNonEmpty,
  SHOPIFY_API_VERSION: optionalNonEmpty.default("2026-07"),
  SHOPIFY_TRACKING_REFRESH_LIMIT: z.coerce.number().int().positive().default(1000),
  APP_DEFAULT_SYNC_DAYS: z.coerce.number().int().positive().default(30)
});

export type ServerEnv = z.infer<typeof envSchema>;

export function getServerEnv(): ServerEnv {
  return envSchema.parse(process.env);
}

export function getEnvStatus() {
  const result = envSchema.safeParse(process.env);
  const requiredKeys = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SHOPIFY_SHOP_DOMAIN",
    "SHOPIFY_CLIENT_ID",
    "SHOPIFY_CLIENT_SECRET"
  ] as const;

  const missing = requiredKeys.filter((key) => !process.env[key]);

  return {
    isValid: result.success,
    missing,
    errors: result.success
      ? []
      : result.error.issues.map((issue) => ({
          key: issue.path.join("."),
          message: issue.message
        }))
  };
}
