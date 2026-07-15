"use client";

import { useState, type FormEvent } from "react";
import { RefreshCcw } from "lucide-react";

import type { SyncBaseline } from "@/lib/sync/shopify-orders";

type SyncResponse = {
  courierSync: {
    checked: number;
    failed: number;
    skipped: number;
    updated: number;
  } | null;
  courierSyncError: string | null;
  status: "Success" | "Partial" | "Failed";
  message: string;
  orderSync: {
    baseline: SyncBaseline | null;
    ordersChecked: number;
    ordersInserted: number;
    ordersUpdated: number;
    status: "Success" | "Partial" | "Failed";
  };
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
        courierSync: null,
        courierSyncError: error instanceof Error ? error.message : "Sync request failed.",
        message: error instanceof Error ? error.message : "Sync request failed.",
        orderSync: {
          status: "Failed",
          baseline,
          ordersChecked: 0,
          ordersInserted: 0,
          ordersUpdated: 0
        }
      });
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Order + courier sync</h2>
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
            <button aria-busy={isSyncing} className="button" disabled={isSyncing} type="submit">
              <RefreshCcw aria-hidden="true" size={18} />
              {isSyncing ? "Syncing" : "Sync Orders + Courier"}
            </button>
          </div>
        </form>

        {isSyncing ? (
          <div className="running-state">
            <RefreshCcw aria-hidden="true" className="spin" size={18} />
            <div>
              <strong>Full sync is running</strong>
              <p>Fetching Shopify orders first, then checking courier tracking one by one.</p>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className={result.status === "Success" ? "notice success" : result.status === "Partial" ? "notice warning" : "notice error"}>
            <strong>{result.status}</strong>
            <p>{result.message}</p>
            <div className="result-grid">
              <span>Shopify checked: {result.orderSync.ordersChecked}</span>
              <span>Shopify inserted: {result.orderSync.ordersInserted}</span>
              <span>Shopify updated: {result.orderSync.ordersUpdated}</span>
              <span>Courier checked: {result.courierSync?.checked ?? 0}</span>
              <span>Courier updated: {result.courierSync?.updated ?? 0}</span>
              <span>Courier failed: {result.courierSync?.failed ?? (result.courierSyncError ? 1 : 0)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
