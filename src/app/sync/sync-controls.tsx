"use client";

import { useState, type FormEvent } from "react";
import { RefreshCcw } from "lucide-react";

import type { SyncBaseline } from "@/lib/sync/shopify-orders";

type SyncResponse = {
  baseline: SyncBaseline | null;
  status: "Success" | "Partial" | "Failed";
  ordersChecked: number;
  ordersInserted: number;
  ordersUpdated: number;
  message: string;
};

type SyncControlsProps = {
  baseline: SyncBaseline | null;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

export function SyncControls({ baseline }: SyncControlsProps) {
  const [afterOrderName, setAfterOrderName] = useState(baseline?.orderName ?? "");
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSyncing(true);
    setResult(null);

    try {
      const response = await fetch("/api/sync/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ afterOrderName })
      });

      const data = (await response.json()) as SyncResponse;
      setResult(data);
    } catch (error) {
      setResult({
        status: "Failed",
        baseline,
        ordersChecked: 0,
        ordersInserted: 0,
        ordersUpdated: 0,
        message: error instanceof Error ? error.message : "Sync request failed."
      });
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Shopify order sync</h2>
        <span className="badge ready">Manual</span>
      </div>
      <div className="panel-body">
        <div className="sync-baseline">
          <div>
            <span>Last synced order</span>
            <strong>{baseline?.orderName ?? "No local orders yet"}</strong>
          </div>
          <div>
            <span>Last synced at</span>
            <strong>{formatDateTime(baseline?.lastSyncedAt ?? null)}</strong>
          </div>
          <div>
            <span>Order date</span>
            <strong>{baseline?.orderDate ?? "-"}</strong>
          </div>
        </div>

        <form className="form-grid sync-form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Sync after order ID</span>
            <input
              placeholder="#15336"
              value={afterOrderName}
              onChange={(event) => setAfterOrderName(event.target.value)}
            />
            <small>Leave as the last synced order to pull only newer Shopify orders.</small>
          </label>
          <div className="form-actions">
            {baseline ? (
              <button className="button secondary" type="button" onClick={() => setAfterOrderName(baseline.orderName)}>
                Use Last Synced
              </button>
            ) : null}
            <button className="button" disabled={isSyncing} type="submit">
              <RefreshCcw aria-hidden="true" size={18} />
              {isSyncing ? "Syncing" : "Sync Shopify Orders"}
            </button>
          </div>
        </form>

        {result ? (
          <div className={result.status === "Success" ? "notice success" : "notice error"}>
            <strong>{result.status}</strong>
            <p>{result.message}</p>
            <div className="result-grid">
              <span>Checked: {result.ordersChecked}</span>
              <span>Inserted: {result.ordersInserted}</span>
              <span>Updated: {result.ordersUpdated}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
