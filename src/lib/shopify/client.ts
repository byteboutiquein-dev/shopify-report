import "server-only";

import { getServerEnv } from "@/lib/env";

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type ShopifyTokenResponse = {
  access_token: string;
  expires_in: number;
};

let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;

function formatShopifyTokenError(status: number, body: string, statusText: string) {
  if (body.includes("app_not_installed")) {
    return "Shopify app is not installed on this shop. Install the Dev Dashboard app on the same store, then retry sync.";
  }

  const titleMatch = body.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();

  return `Shopify token request failed with HTTP ${status}: ${title || body || statusText}`;
}

async function getShopifyAccessToken() {
  const env = getServerEnv();

  if (!env.SHOPIFY_SHOP_DOMAIN || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
    throw new Error("Shopify Dev Dashboard credentials are not configured.");
  }

  if (cachedAccessToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const response = await fetch(`https://${env.SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(formatShopifyTokenError(response.status, errorBody, response.statusText));
  }

  const token = (await response.json()) as ShopifyTokenResponse;
  cachedAccessToken = token.access_token;
  cachedTokenExpiresAt = Date.now() + token.expires_in * 1000;

  return cachedAccessToken;
}

export async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const env = getServerEnv();

  if (!env.SHOPIFY_SHOP_DOMAIN) {
    throw new Error("SHOPIFY_SHOP_DOMAIN is not configured.");
  }

  const accessToken = await getShopifyAccessToken();

  const response = await fetch(
    `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store"
    }
  );

  const payload = (await response.json()) as ShopifyGraphqlResponse<T>;

  if (!response.ok) {
    throw new Error(`Shopify request failed with HTTP ${response.status}.`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("Shopify response did not include data.");
  }

  return payload.data;
}
