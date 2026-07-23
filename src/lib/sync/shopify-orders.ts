import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAppSettings } from "@/lib/app-settings";
import { getServerEnv } from "@/lib/env";
import { resolveTrackingUrl } from "@/lib/courier/tracking-links";
import { fetchShopifyOrders, type ShopifyOrderNode } from "@/lib/shopify/orders";

type SyncInput = {
  afterOrderName?: string;
  syncType?: "Manual" | "Scheduled";
};

export type SyncBaseline = {
  lastSyncedAt: string | null;
  orderDate: string;
  orderName: string;
  shopifyOrderId: string;
};

export type SyncResult = {
  baseline: SyncBaseline | null;
  status: "Success" | "Partial" | "Failed";
  ordersChecked: number;
  ordersInserted: number;
  ordersUpdated: number;
  message: string;
};

type ShopRecord = {
  id: string;
  shop_domain: string;
  shop_name: string | null;
};

type OrderRecord = {
  id: string;
  shopify_order_id: string;
};

type SyncBaselineRecord = {
  last_synced_at: string | null;
  order_date: string;
  order_name: string;
  shopify_order_id: string;
};

type TrackingRecord = {
  courier_charge: number | null;
  courier_name: string | null;
  order_id: string;
  tracking_id: string | null;
  tracking_status: string | null;
  tracking_url: string | null;
};

type ShopifyTrackingFields = {
  courierCharge: number | null;
  courierName: string | null;
  trackingId: string | null;
  trackingUrl: string | null;
};

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function getFirstTracking(order: ShopifyOrderNode) {
  return order.fulfillments.flatMap((fulfillment) => fulfillment.trackingInfo)[0];
}

function parseMoneyMetafield(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  const direct = Number(normalized);

  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const match = normalized.match(/\d+(?:\.\d+)?/);
  const amount = match ? Number(match[0]) : Number.NaN;

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function getShippingCharge(order: ShopifyOrderNode) {
  return parseMoneyMetafield(order.shippingChargeMetafield?.value);
}

function getShopifyTrackingFields(order: ShopifyOrderNode): ShopifyTrackingFields {
  const tracking = getFirstTracking(order);

  return {
    courierCharge: getShippingCharge(order),
    courierName: tracking?.company?.trim() || null,
    trackingId: tracking?.number?.trim() || null,
    trackingUrl: resolveTrackingUrl(tracking?.company, tracking?.number, tracking?.url)
  };
}

function toOrderDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString().slice(0, 10);
}

function addressName(address: ShopifyOrderNode["shippingAddress"] | ShopifyOrderNode["billingAddress"]) {
  const fullName = [address?.firstName, address?.lastName].filter(Boolean).join(" ").trim();
  return address?.name?.trim() || fullName || null;
}

function mapShopifyOrder(shopId: string, order: ShopifyOrderNode) {
  const customerName = addressName(order.shippingAddress) ?? addressName(order.billingAddress);
  const shippingState = order.shippingAddress?.province ?? order.shippingAddress?.provinceCode ?? null;
  const orderPayload: Record<string, string | number | null> = {
    shop_id: shopId,
    shopify_order_id: order.id,
    order_name: order.name,
    order_date: toOrderDate(order.createdAt),
    customer_name: customerName,
    total_price: Number(order.totalPriceSet.shopMoney.amount),
    currency: order.totalPriceSet.shopMoney.currencyCode,
    financial_status: order.displayFinancialStatus,
    fulfillment_status: order.displayFulfillmentStatus,
    shipping_city: order.shippingAddress?.city ?? null,
    shipping_state: shippingState,
    shopify_updated_at: order.updatedAt,
    last_synced_at: new Date().toISOString()
  };

  return orderPayload;
}

async function ensureShop() {
  const env = getServerEnv();

  if (!env.SHOPIFY_SHOP_DOMAIN) {
    throw new Error("SHOPIFY_SHOP_DOMAIN is not configured.");
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("shops")
    .upsert(
      {
        shop_domain: env.SHOPIFY_SHOP_DOMAIN,
        shop_name: env.SHOPIFY_SHOP_DOMAIN,
        is_active: true
      },
      { onConflict: "shop_domain" }
    )
    .select("id, shop_domain, shop_name")
    .single<ShopRecord>();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create or read shop record.");
  }

  return data;
}

function mapSyncBaseline(row: SyncBaselineRecord): SyncBaseline {
  return {
    lastSyncedAt: row.last_synced_at,
    orderDate: row.order_date,
    orderName: row.order_name,
    shopifyOrderId: row.shopify_order_id
  };
}

async function getLatestSyncBaselineForShop(shopId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("orders")
    .select("order_name, order_date, shopify_order_id, last_synced_at")
    .eq("shop_id", shopId)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SyncBaselineRecord>();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapSyncBaseline(data) : null;
}

async function getSyncBaselineByOrderName(shopId: string, orderName: string) {
  const supabase = createServerSupabaseClient();
  const normalizedOrderName = orderName.trim().startsWith("#") ? orderName.trim() : `#${orderName.trim()}`;
  const { data, error } = await supabase
    .from("orders")
    .select("order_name, order_date, shopify_order_id, last_synced_at")
    .eq("shop_id", shopId)
    .eq("order_name", normalizedOrderName)
    .limit(1)
    .maybeSingle<SyncBaselineRecord>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error(`Could not find local order ${normalizedOrderName}. Run a full initial sync first or use an existing order number.`);
  }

  return mapSyncBaseline(data);
}

export async function getSyncBaseline(): Promise<SyncBaseline | null> {
  const env = getServerEnv();

  if (!env.SHOPIFY_SHOP_DOMAIN) {
    return null;
  }

  const supabase = createServerSupabaseClient();
  const shopResponse = await supabase
    .from("shops")
    .select("id")
    .eq("shop_domain", env.SHOPIFY_SHOP_DOMAIN)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (shopResponse.error || !shopResponse.data) {
    return null;
  }

  return getLatestSyncBaselineForShop(shopResponse.data.id);
}

async function createSyncLog(syncType: "Manual" | "Scheduled") {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("sync_logs")
    .insert({
      sync_type: syncType,
      started_at: new Date().toISOString(),
      status: "Success"
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create sync log.");
  }

  return data.id;
}

async function finishSyncLog(syncLogId: string, result: Omit<SyncResult, "message">, errorMessage?: string) {
  const supabase = createServerSupabaseClient();

  await supabase
    .from("sync_logs")
    .update({
      finished_at: new Date().toISOString(),
      status: result.status,
      orders_checked: result.ordersChecked,
      orders_inserted: result.ordersInserted,
      orders_updated: result.ordersUpdated,
      error_message: errorMessage ?? null
    })
    .eq("id", syncLogId);
}

async function getExistingOrders(shopId: string, shopifyOrderIds: string[]) {
  const supabase = createServerSupabaseClient();
  const existingOrders: OrderRecord[] = [];

  for (const idChunk of chunkValues(shopifyOrderIds, 50)) {
    const existingResponse = await supabase
      .from("orders")
      .select("id, shopify_order_id")
      .eq("shop_id", shopId)
      .in("shopify_order_id", idChunk)
      .returns<OrderRecord[]>();

    if (existingResponse.error) {
      throw new Error(existingResponse.error.message);
    }

    existingOrders.push(...(existingResponse.data ?? []));
  }

  return existingOrders;
}

function mergeShopifyOrdersById(...orderGroups: ShopifyOrderNode[][]) {
  const orderById = new Map<string, ShopifyOrderNode>();

  for (const orders of orderGroups) {
    for (const order of orders) {
      orderById.set(order.id, order);
    }
  }

  return [...orderById.values()];
}

async function refreshOrderDetailsFromShopifyOrders(
  shopId: string,
  shopifyOrders: ShopifyOrderNode[],
  excludeShopifyIds = new Set<string>()
) {
  if (!shopifyOrders.length) {
    return 0;
  }

  const existingOrders = await getExistingOrders(
    shopId,
    shopifyOrders.map((order) => order.id)
  );
  const existingShopifyIds = new Set(existingOrders.map((order) => order.shopify_order_id));
  const orderPayload = shopifyOrders
    .filter((order) => existingShopifyIds.has(order.id) && !excludeShopifyIds.has(order.id))
    .map((order) => mapShopifyOrder(shopId, order));

  if (!orderPayload.length) {
    return 0;
  }

  const supabase = createServerSupabaseClient();
  const response = await supabase.from("orders").upsert(orderPayload, { onConflict: "shop_id,shopify_order_id" });

  if (response.error) {
    throw new Error(response.error.message);
  }

  return orderPayload.length;
}

async function refreshTrackingFromShopifyOrders(shopId: string, shopifyOrders: ShopifyOrderNode[]) {
  const supabase = createServerSupabaseClient();
  const shopifyOrdersWithTracking = shopifyOrders.filter((order) => {
    const tracking = getShopifyTrackingFields(order);
    return Boolean(tracking.trackingId || tracking.courierCharge !== null);
  });

  if (!shopifyOrdersWithTracking.length) {
    return 0;
  }

  const existingOrders = await getExistingOrders(
    shopId,
    shopifyOrdersWithTracking.map((order) => order.id)
  );
  const orderIdByShopifyId = new Map(existingOrders.map((order) => [order.shopify_order_id, order.id]));
  const trackingByOrderId = new Map<string, ShopifyTrackingFields>();

  for (const shopifyOrder of shopifyOrdersWithTracking) {
    const orderId = orderIdByShopifyId.get(shopifyOrder.id);

    if (orderId) {
      trackingByOrderId.set(orderId, getShopifyTrackingFields(shopifyOrder));
    }
  }

  if (!trackingByOrderId.size) {
    return 0;
  }

  let updated = 0;

  for (const orderIds of chunkValues([...trackingByOrderId.keys()], 50)) {
    const existingTracking = await supabase
      .from("order_tracking")
      .select("order_id, courier_charge, courier_name, tracking_id, tracking_status, tracking_url")
      .in("order_id", orderIds)
      .returns<TrackingRecord[]>();

    if (existingTracking.error) {
      throw new Error(existingTracking.error.message);
    }

    const existingOrderIds = new Set((existingTracking.data ?? []).map((row) => row.order_id));
    const missingRows = orderIds.filter((orderId) => !existingOrderIds.has(orderId));
    type TrackingInsertRow = {
      courier_charge: number | null;
      courier_name: string | null;
      delivery_status: string;
      order_id: string;
      tracking_id: string | null;
      tracking_status: string;
      tracking_url: string | null;
    };

    if (missingRows.length) {
      const insertRows = missingRows
        .map((orderId) => {
          const tracking = trackingByOrderId.get(orderId);

          if (!tracking || (!tracking.trackingId && tracking.courierCharge === null)) {
            return null;
          }

          return {
            courier_charge: tracking.courierCharge,
            courier_name: tracking.courierName,
            delivery_status: "Pending",
            order_id: orderId,
            tracking_id: tracking.trackingId,
            tracking_status: tracking.trackingId ? "Sent" : "Pending",
            tracking_url: tracking.trackingUrl
          };
        })
        .filter((row): row is TrackingInsertRow => Boolean(row));

      if (insertRows.length) {
        const insertResponse = await supabase.from("order_tracking").insert(insertRows);

        if (insertResponse.error) {
          throw new Error(insertResponse.error.message);
        }

        updated += insertRows.length;
      }
    }

    const rowsToUpdate = (existingTracking.data ?? []).flatMap((row) => {
      const tracking = trackingByOrderId.get(row.order_id);

      if (!tracking) {
        return [];
      }

      const payload: Partial<Record<keyof TrackingRecord, string | number | null>> = {};

      if (!row.tracking_id?.trim() && tracking.trackingId) {
        payload.tracking_id = tracking.trackingId;
        payload.tracking_status = "Sent";
      }

      if (tracking.trackingUrl && row.tracking_url !== tracking.trackingUrl) {
        payload.tracking_url = tracking.trackingUrl;
      }

      if ((!row.courier_name?.trim() || /^other$/i.test(row.courier_name)) && tracking.courierName) {
        payload.courier_name = tracking.courierName;
      }

      if (tracking.courierCharge !== null && row.courier_charge !== tracking.courierCharge) {
        payload.courier_charge = tracking.courierCharge;
      }

      return Object.keys(payload).length
        ? [
            {
              order_id: row.order_id,
              payload
            }
          ]
        : [];
    });

    for (const row of rowsToUpdate) {
      const updateResponse = await supabase.from("order_tracking").update(row.payload).eq("order_id", row.order_id);

      if (updateResponse.error) {
        throw new Error(updateResponse.error.message);
      }

      updated += 1;
    }
  }

  return updated;
}

export async function syncShopifyOrders(input: SyncInput): Promise<SyncResult> {
  let syncLogId: string | null = null;
  let baseline: SyncBaseline | null = null;
  const syncType = input.syncType ?? "Manual";

  try {
    const shop = await ensureShop();
    const appSettings = await getAppSettings();
    syncLogId = await createSyncLog(syncType);
    const supabase = createServerSupabaseClient();
    baseline = input.afterOrderName?.trim()
      ? await getSyncBaselineByOrderName(shop.id, input.afterOrderName)
      : await getLatestSyncBaselineForShop(shop.id);
    const shopifyOrders = await fetchShopifyOrders({
      stopAtShopifyOrderId: baseline?.shopifyOrderId
    });

    if (shopifyOrders.length === 0) {
      const trackingRefreshOrders = await fetchShopifyOrders({
        limit: appSettings.shopifyTrackingRefreshLimit,
        startDate: dateDaysAgo(appSettings.shopifyOrderRefreshDays)
      });
      const orderDetailsUpdated = await refreshOrderDetailsFromShopifyOrders(shop.id, trackingRefreshOrders);
      const trackingRowsUpdated = await refreshTrackingFromShopifyOrders(shop.id, trackingRefreshOrders);
      const result = {
        baseline,
        status: "Success" as const,
        ordersChecked: 0,
        ordersInserted: 0,
        ordersUpdated: orderDetailsUpdated
      };

      await finishSyncLog(syncLogId, result);

      return {
        ...result,
        message: baseline
          ? `No new Shopify orders found after ${baseline.orderName}. Refreshed order details for ${orderDetailsUpdated} orders and tracking for ${trackingRowsUpdated} orders from the last ${appSettings.shopifyOrderRefreshDays} days.`
          : `No Shopify orders were found for initial sync. Refreshed order details for ${orderDetailsUpdated} orders and tracking for ${trackingRowsUpdated} orders from the last ${appSettings.shopifyOrderRefreshDays} days.`
      };
    }

    const shopifyIds = shopifyOrders.map((order) => order.id);
    const existingOrders = await getExistingOrders(shop.id, shopifyIds);
    const existingIds = new Set(existingOrders.map((order) => order.shopify_order_id));
    const orderPayload = shopifyOrders.map((order) => mapShopifyOrder(shop.id, order));
    const upsertResponse = await supabase
      .from("orders")
      .upsert(orderPayload, { onConflict: "shop_id,shopify_order_id" })
      .select("id, shopify_order_id")
      .returns<OrderRecord[]>();

    if (upsertResponse.error || !upsertResponse.data) {
      throw new Error(upsertResponse.error?.message ?? "Could not upsert synced orders.");
    }

    const insertedOrders = upsertResponse.data.filter((order) => !existingIds.has(order.shopify_order_id));
    const insertedOrderByShopifyId = new Map(insertedOrders.map((order) => [order.shopify_order_id, order.id]));

    const trackingRows = shopifyOrders
      .filter((order) => insertedOrderByShopifyId.has(order.id))
      .map((order) => {
        const tracking = getShopifyTrackingFields(order);

        return {
          order_id: insertedOrderByShopifyId.get(order.id),
          courier_charge: tracking.courierCharge,
          courier_name: tracking.courierName,
          tracking_id: tracking.trackingId,
          tracking_url: tracking.trackingUrl,
          tracking_status: tracking.trackingId ? "Sent" : "Pending",
          delivery_status: "Pending"
        };
      });

    const communicationRows = insertedOrders.map((order) => ({
      order_id: order.id,
      confirm_txt_status: "Pending",
      tracking_txt_status: "Pending",
      review_txt_status: "Pending"
    }));

    if (trackingRows.length) {
      const trackingResponse = await supabase.from("order_tracking").insert(trackingRows);

      if (trackingResponse.error) {
        throw new Error(trackingResponse.error.message);
      }
    }

    if (communicationRows.length) {
      const communicationResponse = await supabase.from("order_communication").insert(communicationRows);

      if (communicationResponse.error) {
        throw new Error(communicationResponse.error.message);
      }
    }

    const trackingRefreshOrders = await fetchShopifyOrders({
      limit: appSettings.shopifyTrackingRefreshLimit,
      startDate: dateDaysAgo(appSettings.shopifyOrderRefreshDays)
    });
    const recentRefreshOrders = mergeShopifyOrdersById(shopifyOrders, trackingRefreshOrders);
    const orderDetailsUpdated = await refreshOrderDetailsFromShopifyOrders(
      shop.id,
      recentRefreshOrders,
      new Set(insertedOrders.map((order) => order.shopify_order_id))
    );
    const trackingRowsUpdated = await refreshTrackingFromShopifyOrders(
      shop.id,
      recentRefreshOrders
    );

    const result = {
      baseline,
      status: "Success" as const,
      ordersChecked: shopifyOrders.length,
      ordersInserted: insertedOrders.length,
      ordersUpdated: shopifyOrders.length - insertedOrders.length + orderDetailsUpdated
    };

    await finishSyncLog(syncLogId, result);

    return {
      ...result,
      message: baseline
        ? `Synced ${shopifyOrders.length} Shopify orders after ${baseline.orderName}. Refreshed order details for ${orderDetailsUpdated} orders and tracking for ${trackingRowsUpdated} orders from the last ${appSettings.shopifyOrderRefreshDays} days.`
        : `Synced ${shopifyOrders.length} Shopify orders. Refreshed order details for ${orderDetailsUpdated} orders and tracking for ${trackingRowsUpdated} orders from the last ${appSettings.shopifyOrderRefreshDays} days.`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync failure.";
    const result = {
      baseline,
      status: "Failed" as const,
      ordersChecked: 0,
      ordersInserted: 0,
      ordersUpdated: 0
    };

    if (syncLogId) {
      await finishSyncLog(syncLogId, result, message);
    }

    return {
      ...result,
      message
    };
  }
}
