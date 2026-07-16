import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TrackingCheckLogItemRow = {
  checked_at: string | null;
  courier_name: string | null;
  error_message: string | null;
  fetched_courier_date: string | null;
  fetched_delivery_date: string | null;
  fetched_delivery_status: string | null;
  fetched_tracking_status: string | null;
  id: string;
  log_id: string;
  new_courier_date: string | null;
  new_delivery_date: string | null;
  new_delivery_status: string | null;
  new_tracking_status: string | null;
  order_name: string | null;
  previous_courier_date: string | null;
  previous_delivery_date: string | null;
  previous_delivery_status: string | null;
  previous_tracking_status: string | null;
  status: "Fetched" | "Updated" | "Skipped" | "Failed";
  tracking_id: string | null;
  tracking_url: string | null;
};

export type TrackingCheckLogRow = {
  check_source: string;
  created_at: string;
  error_message: string | null;
  finished_at: string | null;
  id: string;
  items: TrackingCheckLogItemRow[];
  orders_checked: number;
  orders_failed: number;
  orders_skipped: number;
  orders_updated: number;
  started_at: string;
  status: "Success" | "Partial" | "Failed";
};

export async function getRecentTrackingCheckLogs(limit = 5, itemLimit = 250) {
  try {
    const supabase = createServerSupabaseClient();
    const logsResponse = await supabase
      .from("tracking_check_logs")
      .select(
        "id, check_source, started_at, finished_at, status, orders_checked, orders_updated, orders_failed, orders_skipped, error_message, created_at"
      )
      .order("started_at", { ascending: false })
      .limit(limit)
      .returns<Omit<TrackingCheckLogRow, "items">[]>();

    if (logsResponse.error) {
      return {
        error: logsResponse.error.message,
        logs: []
      };
    }

    const logs = logsResponse.data ?? [];
    const logIds = logs.map((log) => log.id);
    const itemsByLogId = new Map<string, TrackingCheckLogItemRow[]>();

    if (logIds.length) {
      const itemsResponse = await supabase
        .from("tracking_check_log_items")
        .select(
          [
            "id",
            "log_id",
            "order_name",
            "courier_name",
            "tracking_id",
            "tracking_url",
            "status",
            "checked_at",
            "previous_courier_date",
            "fetched_courier_date",
            "new_courier_date",
            "previous_delivery_date",
            "fetched_delivery_date",
            "new_delivery_date",
            "previous_delivery_status",
            "fetched_delivery_status",
            "new_delivery_status",
            "previous_tracking_status",
            "fetched_tracking_status",
            "new_tracking_status",
            "error_message"
          ].join(", ")
        )
        .in("log_id", logIds)
        .order("created_at", { ascending: false })
        .limit(itemLimit)
        .returns<TrackingCheckLogItemRow[]>();

      if (itemsResponse.error) {
        return {
          error: itemsResponse.error.message,
          logs: []
        };
      }

      for (const item of itemsResponse.data ?? []) {
        itemsByLogId.set(item.log_id, [...(itemsByLogId.get(item.log_id) ?? []), item]);
      }
    }

    return {
      error: null,
      logs: logs.map((log) => ({
        ...log,
        items: itemsByLogId.get(log.id) ?? []
      }))
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read courier tracking logs.",
      logs: []
    };
  }
}
