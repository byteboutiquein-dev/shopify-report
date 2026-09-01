import "server-only";

import { checkOrderTrackingStatuses, type TrackingStatusCheckResult } from "@/lib/orders/tracking-status";
import { syncShopifyOrders, type SyncResult } from "@/lib/sync/shopify-orders";

type CombinedSyncInput = {
  afterOrderName?: string;
  syncType?: "Manual" | "Scheduled";
};

type CourierSyncSummary = Omit<TrackingStatusCheckResult, "rows">;

export type CombinedSyncResult = {
  courierSync: CourierSyncSummary | null;
  courierSyncError: string | null;
  message: string;
  orderSync: SyncResult;
  ranAt: string;
  status: "Success" | "Partial" | "Failed";
};

function summarizeCourierSync(result: TrackingStatusCheckResult): CourierSyncSummary {
  return {
    checked: result.checked,
    failed: result.failed,
    failures: result.failures,
    logId: result.logId,
    queued: result.queued,
    skipped: result.skipped,
    updated: result.updated
  };
}

function combinedStatus(
  orderSync: SyncResult,
  courierSync: CourierSyncSummary | null,
  courierSyncError: string | null,
  syncType: "Manual" | "Scheduled"
) {
  if (orderSync.status === "Failed" && courierSyncError) {
    return "Failed" as const;
  }

  if (orderSync.status === "Failed" || courierSyncError || (syncType === "Manual" && (courierSync?.failed ?? 0) > 0)) {
    return "Partial" as const;
  }

  return "Success" as const;
}

export async function runCombinedSync(input: CombinedSyncInput = {}): Promise<CombinedSyncResult> {
  const syncType = input.syncType ?? "Manual";
  const orderSync = await syncShopifyOrders({
    afterOrderName: input.afterOrderName,
    syncType
  });

  let courierSync: CourierSyncSummary | null = null;
  let courierSyncError: string | null = null;

  try {
    const courierResult = await checkOrderTrackingStatuses([], {
      includeDelivered: false,
      source: syncType
    });
    courierSync = summarizeCourierSync(courierResult);
  } catch (error) {
    courierSyncError = error instanceof Error ? error.message : "Could not sync courier tracking statuses.";
  }

  const status = combinedStatus(orderSync, courierSync, courierSyncError, syncType);
  const courierText = courierSync
    ? syncType === "Scheduled"
      ? `Courier checked ${courierSync.checked}, updated ${courierSync.updated}, provider blocked ${courierSync.failed}, queued ${courierSync.queued}.`
      : `Courier checked ${courierSync.checked}, updated ${courierSync.updated}, failed ${courierSync.failed}, queued ${courierSync.queued}.`
    : `Courier sync failed: ${courierSyncError}`;

  return {
    courierSync,
    courierSyncError,
    message: `${orderSync.message} ${courierText}`,
    orderSync,
    ranAt: new Date().toISOString(),
    status
  };
}
