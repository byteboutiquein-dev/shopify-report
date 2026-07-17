"use client";

import { useState } from "react";
import { Info, RefreshCw } from "lucide-react";

type HeaderSyncCardsProps = {
  baselineOrderName: string | null;
  isReady: boolean;
  latestOrderStatus: string;
  latestOrderTime: string;
  latestTrackingStatus: string;
  latestTrackingTime: string;
};

type OrderSyncResponse = {
  message?: string;
  ok?: boolean;
};

type CourierSyncResponse = {
  checked?: number;
  failed?: number;
  message?: string;
  ok: boolean;
  skipped?: number;
  updated?: number;
};

type ActiveInfo = "orders" | "courier" | null;

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(value);
}

function refreshReport() {
  window.dispatchEvent(new Event("orders-report-refresh"));
}

export function HeaderSyncCards({
  baselineOrderName,
  isReady,
  latestOrderStatus,
  latestOrderTime,
  latestTrackingStatus,
  latestTrackingTime
}: HeaderSyncCardsProps) {
  const [activeInfo, setActiveInfo] = useState<ActiveInfo>(null);
  const [isCourierSyncing, setIsCourierSyncing] = useState(false);
  const [isOrderSyncing, setIsOrderSyncing] = useState(false);
  const [orderStatus, setOrderStatus] = useState(latestOrderStatus);
  const [orderTime, setOrderTime] = useState(latestOrderTime);
  const [trackingStatus, setTrackingStatus] = useState(latestTrackingStatus);
  const [trackingTime, setTrackingTime] = useState(latestTrackingTime);
  const [message, setMessage] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);

  async function syncOrders() {
    setIsOrderSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/sync/orders", {
        body: JSON.stringify({ afterOrderName: baselineOrderName ?? "" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const data = (await response.json()) as OrderSyncResponse;

      if (!response.ok || data.ok === false) {
        throw new Error(data.message ?? "Could not sync Shopify orders.");
      }

      setMessage({ type: "success", text: data.message ?? "Shopify orders synced." });
      setOrderStatus("Manual · Success");
      setOrderTime(formatDateTime(new Date()));
      refreshReport();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Could not sync Shopify orders."
      });
    } finally {
      setIsOrderSyncing(false);
    }
  }

  async function syncCourierStatus() {
    setIsCourierSyncing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/tracking/check-status", {
        body: JSON.stringify({ orderIds: [] }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const data = (await response.json()) as CourierSyncResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Could not sync courier status.");
      }

      setMessage({
        type: data.failed ? "warning" : "success",
        text: `Courier checked ${data.checked ?? 0}, updated ${data.updated ?? 0}, skipped ${data.skipped ?? 0}, failed ${data.failed ?? 0}.`
      });
      setTrackingStatus(`Manual · ${data.failed ? "Partial" : "Success"}`);
      setTrackingTime(formatDateTime(new Date()));
      refreshReport();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Could not sync courier status."
      });
    } finally {
      setIsCourierSyncing(false);
    }
  }

  return (
    <div className="header-status-wrap">
      <div className="header-status-grid" aria-label="Sync status">
        <article className="header-status-card">
          <div className="header-status-card-top">
            <span>Shopify orders</span>
            <button
              aria-expanded={activeInfo === "orders"}
              aria-label="What does Shopify order sync do?"
              className="header-info-button"
              type="button"
              onClick={() => setActiveInfo((current) => (current === "orders" ? null : "orders"))}
            >
              <Info aria-hidden="true" size={15} />
            </button>
          </div>
          <strong>{orderTime}</strong>
          <small>{orderStatus}</small>
          {activeInfo === "orders" ? (
            <p className="header-sync-info">
              Fetches Shopify orders, customer name, city, tracking ID, courier name, and courier amount. It does not check delivery status.
            </p>
          ) : null}
          <button
            aria-busy={isOrderSyncing}
            className="header-status-action"
            disabled={!isReady || isOrderSyncing || isCourierSyncing}
            type="button"
            onClick={syncOrders}
          >
            <RefreshCw aria-hidden="true" className={isOrderSyncing ? "spin" : ""} size={15} />
            {isOrderSyncing ? "Syncing" : "Sync Orders"}
          </button>
        </article>

        <article className="header-status-card">
          <div className="header-status-card-top">
            <span>Courier status</span>
            <button
              aria-expanded={activeInfo === "courier"}
              aria-label="What does courier status sync do?"
              className="header-info-button"
              type="button"
              onClick={() => setActiveInfo((current) => (current === "courier" ? null : "courier"))}
            >
              <Info aria-hidden="true" size={15} />
            </button>
          </div>
          <strong>{trackingTime}</strong>
          <small>{trackingStatus}</small>
          {activeInfo === "courier" ? (
            <p className="header-sync-info">
              Checks courier tracking pages for orders that have a tracking ID and are not delivered. Delivered orders are skipped.
            </p>
          ) : null}
          <button
            aria-busy={isCourierSyncing}
            className="header-status-action"
            disabled={!isReady || isOrderSyncing || isCourierSyncing}
            type="button"
            onClick={syncCourierStatus}
          >
            <RefreshCw aria-hidden="true" className={isCourierSyncing ? "spin" : ""} size={15} />
            {isCourierSyncing ? "Checking" : "Sync Courier"}
          </button>
        </article>
      </div>

      {message ? (
        <div className={`header-sync-message ${message.type}`}>
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
