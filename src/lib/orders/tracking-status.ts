import "server-only";

import { fetchTrackCourierStatus } from "@/lib/courier/track-courier-status";
import { resolveTrackingUrl } from "@/lib/courier/tracking-links";
import { getOrderReportRow, type ReportRow } from "@/lib/orders/report";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TRACKING_PAGE_SIZE = 500;
const SCHEDULED_TRACKING_DELAY_MS = 10_000;
const SCHEDULED_TRACKING_MAX_ORDERS = 10;
const SCHEDULED_TRACKING_LOOKBACK_DAYS = 30;
const SCHEDULED_TRACKING_MIN_RECHECK_HOURS = 12;
const SCHEDULED_TRACKING_ACTIVE_RUN_MINUTES = 14;

export type TrackingCheckSource = "Manual" | "Scheduled";

type TrackingStatusRow = {
  order_id: string;
  courier_date: string | null;
  courier_name: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
  tracking_id: string | null;
  tracking_checked_at: string | null;
  tracking_check_error: string | null;
  tracking_provider: string | null;
  tracking_status: string | null;
  tracking_url: string | null;
};

type OrderNameRow = {
  id: string;
  order_name: string;
};

type ActiveTrackingCheckLogRow = {
  id: string;
  started_at: string;
};

type TrackingStatusCheckOptions = {
  includeDelivered?: boolean;
  logId?: string | null;
  maxOrders?: number;
  perOrderDelayMs?: number;
  skipActiveRunCheck?: boolean;
  source?: TrackingCheckSource;
  tolerateFailures?: boolean;
};

type TrackingCheckLogItemStatus = "Fetched" | "Updated" | "Skipped" | "Failed";

type TrackingCheckLogItemInsert = {
  checked_at: string | null;
  courier_name: string | null;
  error_message: string | null;
  fetched_courier_date: string | null;
  fetched_delivery_date: string | null;
  fetched_delivery_status: string | null;
  fetched_tracking_status: string | null;
  log_id: string;
  new_courier_date: string | null;
  new_delivery_date: string | null;
  new_delivery_status: string | null;
  new_tracking_status: string | null;
  order_id: string | null;
  order_name: string | null;
  previous_courier_date: string | null;
  previous_delivery_date: string | null;
  previous_delivery_status: string | null;
  previous_tracking_status: string | null;
  status: TrackingCheckLogItemStatus;
  tracking_id: string | null;
  tracking_url: string | null;
};

type TrackingStatusFailure = {
  orderId: string;
  reason: string;
};

export type TrackingStatusCheckResult = {
  checked: number;
  failed: number;
  failures: TrackingStatusFailure[];
  logId: string | null;
  queued: number;
  rows: ReportRow[];
  skipped: number;
  updated: number;
};

export type ScheduledTrackingCheckRun = {
  activeLogId: string | null;
  accepted: boolean;
  logId: string | null;
  message: string;
  startedAt: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valueChanged(oldValue: unknown, newValue: unknown) {
  return String(oldValue ?? "") !== String(newValue ?? "");
}

function keepDeliveredStatus(row: Pick<TrackingStatusRow, "delivery_status" | "tracking_status">) {
  return row.delivery_status === "Delivered" || row.tracking_status === "Delivered";
}

function compareNullableText(left: string | null, right: string | null, nullsFirst = true) {
  if (!left && !right) return 0;
  if (!left) return nullsFirst ? -1 : 1;
  if (!right) return nullsFirst ? 1 : -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareScheduledTrackingRows(left: TrackingStatusRow, right: TrackingStatusRow) {
  const leftCheckFailed = left.tracking_check_error ? 0 : 1;
  const rightCheckFailed = right.tracking_check_error ? 0 : 1;

  return (
    leftCheckFailed - rightCheckFailed ||
    compareNullableText(left.courier_date, right.courier_date, false) ||
    compareNullableText(left.tracking_checked_at, right.tracking_checked_at) ||
    compareNullableText(left.order_id, right.order_id)
  );
}

function scheduledRecheckCutoffIso() {
  const cutoff = new Date(Date.now() - SCHEDULED_TRACKING_MIN_RECHECK_HOURS * 60 * 60 * 1000);
  return cutoff.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function scheduledOrderDateCutoff() {
  const cutoff = new Date(Date.now() - SCHEDULED_TRACKING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

function scheduledActiveRunCutoffIso() {
  const cutoff = new Date(Date.now() - SCHEDULED_TRACKING_ACTIVE_RUN_MINUTES * 60 * 1000);
  return cutoff.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function auditRow(entityId: string, fieldName: string, oldValue: unknown, newValue: unknown) {
  return {
    changed_by: "Courier Status Check",
    entity_id: entityId,
    entity_type: "Tracking",
    field_name: fieldName,
    old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
    new_value: newValue === null || newValue === undefined ? null : String(newValue)
  };
}

function getCourierLookupText(courierName: string, trackingId: string, trackingUrl: string | null) {
  if (/^other$/i.test(courierName)) {
    if (/^[A-Z]{2}\d{9}IN$/i.test(trackingId)) {
      return getCourierLookupText("India Post Domestic", trackingId, trackingUrl);
    }

    if (/^64\d{9}$/.test(trackingId)) {
      return getCourierLookupText("ST Courier", trackingId, trackingUrl);
    }

    if (/^POL\d+$/i.test(trackingId)) {
      return getCourierLookupText("Professional Couriers", trackingId, trackingUrl);
    }

    return getCourierLookupText("ST Courier", trackingId, trackingUrl);
  }

  return [courierName, trackingUrl].filter(Boolean).join(" ");
}

async function fetchTrackingRowsPage(orderIds: string[], options: Required<TrackingStatusCheckOptions>, from: number, to: number) {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("order_tracking")
    .select(
      "order_id, courier_date, courier_name, delivery_date, delivery_status, tracking_id, tracking_checked_at, tracking_check_error, tracking_provider, tracking_status, tracking_url, orders!inner(order_date)"
    )
    .not("tracking_id", "is", null)
    .neq("tracking_id", "");

  if (!orderIds.length && options.source === "Scheduled") {
    query = query
      .or(`tracking_checked_at.is.null,tracking_checked_at.lt.${scheduledRecheckCutoffIso()}`)
      .gte("orders.order_date", scheduledOrderDateCutoff())
      .order("courier_date", { ascending: true, nullsFirst: false })
      .order("tracking_checked_at", { ascending: true, nullsFirst: true })
      .order("updated_at", { ascending: true });
  } else {
    query = query.order("updated_at", { ascending: false });
  }

  query = query.range(from, to);

  if (orderIds.length) {
    query = query.in("order_id", orderIds);
  } else if (!options.includeDelivered) {
    query = query.neq("delivery_status", "Delivered").neq("tracking_status", "Delivered");
  }

  const response = await query.returns<TrackingStatusRow[]>();

  if (response.error) {
    throw new Error(response.error.message);
  }

  return response.data ?? [];
}

async function loadTrackingRows(orderIds: string[], options: Required<TrackingStatusCheckOptions>) {
  if (orderIds.length) {
    return fetchTrackingRowsPage(orderIds, options, 0, Math.max(orderIds.length - 1, 0));
  }

  const rows: TrackingStatusRow[] = [];

  for (let from = 0; ; from += TRACKING_PAGE_SIZE) {
    const page = await fetchTrackingRowsPage(orderIds, options, from, from + TRACKING_PAGE_SIZE - 1);
    rows.push(...page);

    if (page.length < TRACKING_PAGE_SIZE) {
      return options.source === "Scheduled" ? rows.sort(compareScheduledTrackingRows) : rows;
    }
  }
}

async function loadOrderNames(orderIds: string[]) {
  const supabase = createServerSupabaseClient();
  const orderNames = new Map<string, string>();

  for (let index = 0; index < orderIds.length; index += 100) {
    const idChunk = orderIds.slice(index, index + 100);
    const response = await supabase.from("orders").select("id, order_name").in("id", idChunk).returns<OrderNameRow[]>();

    if (response.error) {
      throw new Error(response.error.message);
    }

    for (const order of response.data ?? []) {
      orderNames.set(order.id, order.order_name);
    }
  }

  return orderNames;
}

async function createTrackingCheckLog(source: TrackingCheckSource) {
  const supabase = createServerSupabaseClient();
  const response = await supabase
    .from("tracking_check_logs")
    .insert({
      check_source: source,
      started_at: new Date().toISOString(),
      status: "Success"
    })
    .select("id")
    .single<{ id: string }>();

  if (response.error || !response.data) {
    console.warn("Courier tracking log creation skipped:", response.error?.message ?? "No log row returned.");
    return null;
  }

  return response.data.id;
}

export async function prepareScheduledTrackingCheckRun(): Promise<ScheduledTrackingCheckRun> {
  const startedAt = new Date().toISOString();
  const activeLog = await getActiveScheduledTrackingLog();

  if (activeLog) {
    return {
      activeLogId: activeLog.id,
      accepted: false,
      logId: activeLog.id,
      message: "Scheduled courier status sync skipped because another run is already active.",
      startedAt: activeLog.started_at
    };
  }

  const logId = await createTrackingCheckLog("Scheduled");

  return {
    activeLogId: null,
    accepted: Boolean(logId),
    logId,
    message: logId
      ? "Scheduled courier status sync accepted. Tracking checks will continue in the background with a 10 second gap between orders."
      : "Scheduled courier status sync could not create a tracking log.",
    startedAt
  };
}

async function getActiveScheduledTrackingLog() {
  const supabase = createServerSupabaseClient();
  const response = await supabase
    .from("tracking_check_logs")
    .select("id, started_at")
    .eq("check_source", "Scheduled")
    .is("finished_at", null)
    .gte("started_at", scheduledActiveRunCutoffIso())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<ActiveTrackingCheckLogRow>();

  if (response.error) {
    console.warn("Courier tracking active-run check skipped:", response.error.message);
    return null;
  }

  return response.data ?? null;
}

async function finishTrackingCheckLog(
  logId: string | null,
  result: {
    checked: number;
    failed: number;
    skipped: number;
    status: "Success" | "Partial" | "Failed";
    updated: number;
  },
  errorMessage?: string
) {
  if (!logId) {
    return;
  }

  const supabase = createServerSupabaseClient();
  const response = await supabase
    .from("tracking_check_logs")
    .update({
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
      orders_checked: result.checked,
      orders_failed: result.failed,
      orders_skipped: result.skipped,
      orders_updated: result.updated,
      status: result.status
    })
    .eq("id", logId);

  if (response.error) {
    console.warn("Courier tracking log finish skipped:", response.error.message);
  }
}

async function insertTrackingCheckLogItems(logId: string | null, items: TrackingCheckLogItemInsert[]) {
  if (!logId || !items.length) {
    return;
  }

  const supabase = createServerSupabaseClient();

  for (let index = 0; index < items.length; index += 100) {
    const response = await supabase.from("tracking_check_log_items").insert(items.slice(index, index + 100));

    if (response.error) {
      console.warn("Courier tracking log item insert skipped:", response.error.message);
      return;
    }
  }
}

function createTrackingLogItem(
  logId: string,
  row: TrackingStatusRow,
  orderName: string | undefined,
  status: TrackingCheckLogItemStatus,
  values: {
    checkedAt?: string;
    errorMessage?: string;
    fetchedCourierDate?: string | null;
    fetchedDeliveryDate?: string | null;
    fetchedDeliveryStatus?: string | null;
    fetchedTrackingStatus?: string | null;
    newCourierDate?: string | null;
    newDeliveryDate?: string | null;
    newDeliveryStatus?: string | null;
    newTrackingStatus?: string | null;
    trackingUrl?: string | null;
  } = {}
): TrackingCheckLogItemInsert {
  return {
    checked_at: values.checkedAt ?? null,
    courier_name: row.courier_name,
    error_message: values.errorMessage ?? null,
    fetched_courier_date: values.fetchedCourierDate ?? null,
    fetched_delivery_date: values.fetchedDeliveryDate ?? null,
    fetched_delivery_status: values.fetchedDeliveryStatus ?? null,
    fetched_tracking_status: values.fetchedTrackingStatus ?? null,
    log_id: logId,
    new_courier_date: values.newCourierDate ?? row.courier_date,
    new_delivery_date: values.newDeliveryDate ?? row.delivery_date,
    new_delivery_status: values.newDeliveryStatus ?? row.delivery_status ?? "Pending",
    new_tracking_status: values.newTrackingStatus ?? row.tracking_status ?? "Pending",
    order_id: row.order_id,
    order_name: orderName ?? null,
    previous_courier_date: row.courier_date,
    previous_delivery_date: row.delivery_date,
    previous_delivery_status: row.delivery_status ?? "Pending",
    previous_tracking_status: row.tracking_status ?? "Pending",
    status,
    tracking_id: row.tracking_id,
    tracking_url: values.trackingUrl ?? row.tracking_url
  };
}

export async function checkOrderTrackingStatuses(
  orderIds: string[],
  options: TrackingStatusCheckOptions = {}
): Promise<TrackingStatusCheckResult> {
  const supabase = createServerSupabaseClient();
  const uniqueOrderIds = [...new Set(orderIds.filter(Boolean))];
  const checkOptions = {
    includeDelivered: options.includeDelivered ?? Boolean(uniqueOrderIds.length),
    logId: options.logId ?? null,
    maxOrders:
      options.maxOrders ??
      (options.source === "Scheduled" && !uniqueOrderIds.length ? SCHEDULED_TRACKING_MAX_ORDERS : Number.MAX_SAFE_INTEGER),
    perOrderDelayMs:
      options.perOrderDelayMs ??
      (options.source === "Scheduled" && !uniqueOrderIds.length ? SCHEDULED_TRACKING_DELAY_MS : 0),
    skipActiveRunCheck: options.skipActiveRunCheck ?? false,
    source: options.source ?? "Manual",
    tolerateFailures: options.tolerateFailures ?? options.source === "Scheduled"
  } satisfies Required<TrackingStatusCheckOptions>;

  if (checkOptions.source === "Scheduled" && !uniqueOrderIds.length && !checkOptions.skipActiveRunCheck) {
    const activeLog = await getActiveScheduledTrackingLog();

    if (activeLog) {
      console.log("Scheduled courier status sync skipped because another run is active", activeLog);
      return {
        checked: 0,
        failed: 0,
        failures: [],
        logId: activeLog.id,
        queued: 0,
        rows: [],
        skipped: 0,
        updated: 0
      };
    }
  }

  const logId = checkOptions.logId ?? await createTrackingCheckLog(checkOptions.source);
  const failures: TrackingStatusFailure[] = [];
  const refreshedOrderIds = new Set<string>();
  const logItems: TrackingCheckLogItemInsert[] = [];
  let updated = 0;
  let checked = 0;
  let skipped = 0;

  try {
    const allTrackingRows = await loadTrackingRows(uniqueOrderIds, checkOptions);
    const trackingRows = allTrackingRows.slice(0, checkOptions.maxOrders);
    const queued = Math.max(0, allTrackingRows.length - trackingRows.length);
    const orderNames = await loadOrderNames(trackingRows.map((row) => row.order_id));

    for (let rowIndex = 0; rowIndex < trackingRows.length; rowIndex += 1) {
      const row = trackingRows[rowIndex];
      const courierName = row.courier_name?.trim();
      const trackingId = row.tracking_id?.trim();
      const orderName = orderNames.get(row.order_id);

      if (!courierName || !trackingId) {
        skipped += 1;
        if (logId) {
          logItems.push(
            createTrackingLogItem(logId, row, orderName, "Skipped", {
              errorMessage: !courierName ? "Courier name is missing." : "Tracking ID is missing."
            })
          );
        }
        continue;
      }

      try {
        checked += 1;
        const checkedAt = new Date().toISOString();
        const courierLookupText = getCourierLookupText(courierName, trackingId, row.tracking_url);
        const status = await fetchTrackCourierStatus(courierLookupText, trackingId);
        const preserveDelivered = keepDeliveredStatus(row) && status.deliveryStatus !== "Delivered";
        const newDeliveryStatus = preserveDelivered ? "Delivered" : status.deliveryStatus;
        const newTrackingStatus = preserveDelivered ? "Delivered" : status.trackingStatus;
        const finalDeliveryDate =
          newDeliveryStatus === "Delivered" || newDeliveryStatus === "Returned"
            ? status.deliveryDate ?? row.delivery_date
            : row.delivery_date;
        const payload = {
          courier_date: row.courier_date ?? status.courierDate,
          delivery_date: finalDeliveryDate,
          delivery_status: newDeliveryStatus,
          tracking_checked_at: checkedAt,
          tracking_check_error: null,
          tracking_check_source: checkOptions.source,
          tracking_provider: status.trackingProvider ?? null,
          tracking_status: newTrackingStatus,
          tracking_url: resolveTrackingUrl(courierLookupText, trackingId, row.tracking_url)
        };
        const auditRows = [
          ["courier_date", row.courier_date, payload.courier_date],
          ["delivery_date", row.delivery_date, payload.delivery_date],
          ["delivery_status", row.delivery_status ?? "Pending", payload.delivery_status],
          ["tracking_provider", row.tracking_provider, payload.tracking_provider],
          ["tracking_status", row.tracking_status ?? "Pending", payload.tracking_status],
          ["tracking_url", row.tracking_url, payload.tracking_url]
        ]
          .filter(([, oldValue, newValue]) => valueChanged(oldValue, newValue))
          .map(([fieldName, oldValue, newValue]) => auditRow(row.order_id, fieldName as string, oldValue, newValue));

        const updateResponse = await supabase.from("order_tracking").update(payload).eq("order_id", row.order_id);

        if (updateResponse.error) {
          throw new Error(updateResponse.error.message);
        }

        if (auditRows.length) {
          const auditResponse = await supabase.from("audit_logs").insert(auditRows);

          if (auditResponse.error) {
            throw new Error(auditResponse.error.message);
          }

          updated += 1;
        }

        if (logId) {
          logItems.push(
            createTrackingLogItem(logId, row, orderName, auditRows.length ? "Updated" : "Fetched", {
              checkedAt,
              fetchedCourierDate: status.courierDate,
              fetchedDeliveryDate: status.deliveryDate,
              fetchedDeliveryStatus: status.deliveryStatus,
              fetchedTrackingStatus: status.trackingStatus,
              newCourierDate: payload.courier_date,
              newDeliveryDate: payload.delivery_date,
              newDeliveryStatus: payload.delivery_status,
              newTrackingStatus: payload.tracking_status,
              trackingUrl: payload.tracking_url
            })
          );
        }

        refreshedOrderIds.add(row.order_id);
      } catch (error) {
        const checkedAt = new Date().toISOString();
        const reason = error instanceof Error ? error.message : "Could not check tracking status.";
        const shouldPreserveDelivered = keepDeliveredStatus(row);
        const failurePayload = {
          tracking_checked_at: checkedAt,
          tracking_check_error: reason,
          tracking_check_source: checkOptions.source,
          ...(shouldPreserveDelivered
            ? {}
            : {
                delivery_status: "Check Failed",
                tracking_status: "Failed"
              })
        };
        let failureUpdate = await supabase
          .from("order_tracking")
          .update(failurePayload)
          .eq("order_id", row.order_id);

        if (failureUpdate.error && /constraint|order_delivery_status_check/i.test(failureUpdate.error.message)) {
          failureUpdate = await supabase
            .from("order_tracking")
            .update({
              tracking_checked_at: checkedAt,
              tracking_check_error: reason,
              tracking_check_source: checkOptions.source
            })
            .eq("order_id", row.order_id);
        }

        if (!failureUpdate.error) {
          refreshedOrderIds.add(row.order_id);
        }

        if (logId) {
          logItems.push(
            createTrackingLogItem(logId, row, orderName, "Failed", {
              checkedAt,
              errorMessage: reason,
              newDeliveryStatus: shouldPreserveDelivered ? "Delivered" : "Check Failed",
              newTrackingStatus: shouldPreserveDelivered ? "Delivered" : "Failed"
            })
          );
        }

        failures.push({
          orderId: row.order_id,
          reason
        });
      }

      if (checkOptions.perOrderDelayMs > 0 && rowIndex < trackingRows.length - 1) {
        await sleep(checkOptions.perOrderDelayMs);
      }
    }

    const totalSkipped = skipped + Math.max(0, uniqueOrderIds.length - trackingRows.length);

    await insertTrackingCheckLogItems(logId, logItems);
    await finishTrackingCheckLog(logId, {
      checked,
      failed: failures.length,
      skipped: totalSkipped,
      status: failures.length && !checkOptions.tolerateFailures ? "Partial" : "Success",
      updated
    });

    const rows = await Promise.all([...refreshedOrderIds].map((orderId) => getOrderReportRow(orderId)));

    return {
      checked,
      failed: failures.length,
      failures,
      logId,
      queued,
      rows,
      skipped: totalSkipped,
      updated
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Could not check tracking statuses.";

    await finishTrackingCheckLog(
      logId,
      {
        checked,
        failed: failures.length || 1,
        skipped,
        status: "Failed",
        updated
      },
      reason
    );

    throw error;
  }
}
