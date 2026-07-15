"use client";

import { useState, type FormEvent } from "react";
import { Save } from "lucide-react";

import type { AppSettings } from "@/lib/app-settings";

type SettingsResponse = {
  message?: string;
  ok: boolean;
  settings?: AppSettings;
};

type AppSettingsFormProps = {
  initialSettings: AppSettings;
};

export function AppSettingsForm({ initialSettings }: AppSettingsFormProps) {
  const [deliveryDelayDays, setDeliveryDelayDays] = useState(String(initialSettings.deliveryDelayDays));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [shopifyOrderRefreshDays, setShopifyOrderRefreshDays] = useState(String(initialSettings.shopifyOrderRefreshDays));
  const [shopifyTrackingRefreshLimit, setShopifyTrackingRefreshLimit] = useState(
    String(initialSettings.shopifyTrackingRefreshLimit)
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);

    try {
      const response = await fetch("/api/settings", {
        body: JSON.stringify({
          deliveryDelayDays: Number(deliveryDelayDays),
          shopifyOrderRefreshDays: Number(shopifyOrderRefreshDays),
          shopifyTrackingRefreshLimit: Number(shopifyTrackingRefreshLimit)
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "PATCH"
      });
      const data = (await response.json()) as SettingsResponse;

      if (!response.ok || !data.ok || !data.settings) {
        throw new Error(data.message ?? "Could not save app settings.");
      }

      setDeliveryDelayDays(String(data.settings.deliveryDelayDays));
      setShopifyOrderRefreshDays(String(data.settings.shopifyOrderRefreshDays));
      setShopifyTrackingRefreshLimit(String(data.settings.shopifyTrackingRefreshLimit));
      setNotice({ message: "Settings saved. New sync/delay actions will use these values.", type: "success" });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Could not save app settings.",
        type: "error"
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>App settings</h2>
        <span className="badge ready">Config</span>
      </div>
      <div className="panel-body">
        <form className="form-grid sync-form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Shopify order refresh days</span>
            <input
              max={120}
              min={1}
              type="number"
              value={shopifyOrderRefreshDays}
              onChange={(event) => setShopifyOrderRefreshDays(event.target.value)}
            />
            <small>Order sync will revisit orders created in the last N days to catch late fulfillment/tracking.</small>
          </label>
          <label className="field">
            <span>Shopify tracking refresh orders</span>
            <input
              max={5000}
              min={1}
              type="number"
              value={shopifyTrackingRefreshLimit}
              onChange={(event) => setShopifyTrackingRefreshLimit(event.target.value)}
            />
            <small>Order sync will revisit this many recent Shopify orders to catch late tracking IDs.</small>
          </label>
          <label className="field">
            <span>Delayed delivery after days</span>
            <input
              max={30}
              min={1}
              type="number"
              value={deliveryDelayDays}
              onChange={(event) => setDeliveryDelayDays(event.target.value)}
            />
            <small>Orders become delayed when courier date age reaches this many days and not delivered.</small>
          </label>
          <div className="form-actions">
            <button className="button" disabled={isSaving} type="submit">
              <Save aria-hidden="true" size={18} />
              {isSaving ? "Saving" : "Save Settings"}
            </button>
          </div>
        </form>
        {notice ? (
          <div className={`notice ${notice.type}`}>
            <strong>{notice.type === "success" ? "Saved" : "Save failed"}</strong>
            <p>{notice.message}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
