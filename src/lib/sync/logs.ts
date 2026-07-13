import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SyncLogRow = {
  id: string;
  sync_type: string;
  started_at: string;
  finished_at: string | null;
  status: "Success" | "Partial" | "Failed";
  orders_checked: number;
  orders_inserted: number;
  orders_updated: number;
  error_message: string | null;
};

export async function getRecentSyncLogs(limit = 20) {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("sync_logs")
      .select(
        "id, sync_type, started_at, finished_at, status, orders_checked, orders_inserted, orders_updated, error_message"
      )
      .order("started_at", { ascending: false })
      .limit(limit)
      .returns<SyncLogRow[]>();

    if (error) {
      return {
        logs: [],
        error: error.message
      };
    }

    return {
      logs: data ?? [],
      error: null
    };
  } catch (error) {
    return {
      logs: [],
      error: error instanceof Error ? error.message : "Could not read sync logs."
    };
  }
}
