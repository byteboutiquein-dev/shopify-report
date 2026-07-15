import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AppSettings = {
  deliveryDelayDays: number;
  shopifyOrderRefreshDays: number;
  shopifyTrackingRefreshLimit: number;
};

const settingKeys = {
  deliveryDelayDays: "delivery_delay_days",
  shopifyOrderRefreshDays: "shopify_order_refresh_days",
  shopifyTrackingRefreshLimit: "shopify_tracking_refresh_limit"
} as const;

const appSettingsSchema = z.object({
  deliveryDelayDays: z.coerce.number().int().min(1).max(30),
  shopifyOrderRefreshDays: z.coerce.number().int().min(1).max(120),
  shopifyTrackingRefreshLimit: z.coerce.number().int().min(1).max(5000)
});

type AppSettingRow = {
  key: string;
  value: string;
};

export function getDefaultAppSettings(): AppSettings {
  const env = getServerEnv();

  return {
    deliveryDelayDays: 4,
    shopifyOrderRefreshDays: 30,
    shopifyTrackingRefreshLimit: env.SHOPIFY_TRACKING_REFRESH_LIMIT
  };
}

export async function getAppSettings(): Promise<AppSettings> {
  const defaults = getDefaultAppSettings();

  try {
    const supabase = createServerSupabaseClient();
    const response = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(settingKeys))
      .returns<AppSettingRow[]>();

    if (response.error) {
      return defaults;
    }

    const valueByKey = new Map((response.data ?? []).map((row) => [row.key, row.value]));
    const parsed = appSettingsSchema.safeParse({
      deliveryDelayDays: valueByKey.get(settingKeys.deliveryDelayDays) ?? defaults.deliveryDelayDays,
      shopifyOrderRefreshDays: valueByKey.get(settingKeys.shopifyOrderRefreshDays) ?? defaults.shopifyOrderRefreshDays,
      shopifyTrackingRefreshLimit:
        valueByKey.get(settingKeys.shopifyTrackingRefreshLimit) ?? defaults.shopifyTrackingRefreshLimit
    });

    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}

export async function saveAppSettings(input: AppSettings) {
  const parsed = appSettingsSchema.parse(input);
  const supabase = createServerSupabaseClient();
  const response = await supabase.from("app_settings").upsert(
    [
      {
        key: settingKeys.deliveryDelayDays,
        updated_at: new Date().toISOString(),
        value: String(parsed.deliveryDelayDays)
      },
      {
        key: settingKeys.shopifyOrderRefreshDays,
        updated_at: new Date().toISOString(),
        value: String(parsed.shopifyOrderRefreshDays)
      },
      {
        key: settingKeys.shopifyTrackingRefreshLimit,
        updated_at: new Date().toISOString(),
        value: String(parsed.shopifyTrackingRefreshLimit)
      }
    ],
    { onConflict: "key" }
  );

  if (response.error) {
    throw new Error(response.error.message);
  }

  return parsed;
}
