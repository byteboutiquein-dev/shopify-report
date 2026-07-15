import { OrdersReport } from "@/app/orders/orders-report";
import { AppSettingsForm } from "@/app/settings/app-settings-form";
import { SettingsDrawer } from "@/app/settings/settings-drawer";
import { SyncControls } from "@/app/sync/sync-controls";
import { getAppSettings } from "@/lib/app-settings";
import { getEnvStatus } from "@/lib/env";
import { getOrdersReportRows } from "@/lib/orders/report";
import { getRecentTrackingCheckLogs } from "@/lib/orders/tracking-logs";
import { getRecentSyncLogs } from "@/lib/sync/logs";
import { getSyncBaseline } from "@/lib/sync/shopify-orders";

export const dynamic = "force-dynamic";

function currentDateInKolkata() {
  const parts = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).formatToParts(new Date());
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get("year")}-${valueByType.get("month")}-${valueByType.get("day")}`;
}

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

function formatValue(value: string | null) {
  return value || "-";
}

export default async function HomePage() {
  const envStatus = getEnvStatus();
  const currentDate = currentDateInKolkata();
  const [report, syncLogs, trackingLogs, appSettings, baseline] = await Promise.all([
    getOrdersReportRows({ page: 1, pageSize: 100 }),
    getRecentSyncLogs(8),
    getRecentTrackingCheckLogs(5),
    getAppSettings(),
    getSyncBaseline()
  ]);
  const latestOrderSync = syncLogs.logs[0] ?? null;
  const latestTrackingSync = trackingLogs.logs[0] ?? null;

  return (
    <>
      <header className="product-header">
        <div className="product-title">
          <p className="eyebrow">Shopify Sync Report</p>
          <h1>Kuviyal Tracking</h1>
          <p className="page-copy">See urgent shipments first, sync Shopify tracking, and follow up on delayed orders.</p>
        </div>
        <div className="header-status-grid" aria-label="Sync status">
          <div className="header-status-card">
            <span>Shopify orders</span>
            <strong>{formatDateTime(latestOrderSync?.finished_at ?? latestOrderSync?.started_at ?? null)}</strong>
            <small>{latestOrderSync ? `${latestOrderSync.sync_type} · ${latestOrderSync.status}` : "No sync yet"}</small>
          </div>
          <div className="header-status-card">
            <span>Courier status</span>
            <strong>{formatDateTime(latestTrackingSync?.finished_at ?? latestTrackingSync?.started_at ?? null)}</strong>
            <small>{latestTrackingSync ? `${latestTrackingSync.check_source} · ${latestTrackingSync.status}` : "No check yet"}</small>
          </div>
        </div>
        <div className="header-actions">
          <SettingsDrawer isReady={envStatus.missing.length === 0 && envStatus.isValid}>
          {envStatus.missing.length ? (
            <div className="notice error">
              <strong>Configuration needed</strong>
              <p>Fill `.env.local` before running Shopify sync.</p>
            </div>
          ) : null}
          <section className="settings-section">
            <div className="settings-section-heading">
              <span>01</span>
              <div>
                <h3>Rules</h3>
                <p>Configure how the operations desk decides what needs attention.</p>
              </div>
            </div>
            <AppSettingsForm initialSettings={appSettings} />
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <span>02</span>
              <div>
                <h3>Manual Sync</h3>
                <p>Run Shopify order sync when you need fresh order or tracking data immediately.</p>
              </div>
            </div>
            <SyncControls baseline={baseline} />
          </section>

          <section className="settings-section">
            <div className="settings-section-heading">
              <span>03</span>
              <div>
                <h3>History</h3>
                <p>Review the latest order-sync and courier-check activity.</p>
              </div>
            </div>
            <details className="settings-disclosure nested">
              <summary>
                <span>Recent Shopify order sync logs</span>
                <span className="badge ready">{syncLogs.logs.length}</span>
              </summary>
              <section className="panel">
                <div className="panel-body">
                  {syncLogs.error ? (
                    <div className="notice error">
                      <strong>Sync logs unavailable</strong>
                      <p>{syncLogs.error}</p>
                    </div>
                  ) : syncLogs.logs.length ? (
                    <div className="sync-log-cards">
                      {syncLogs.logs.map((log) => (
                        <article className="sync-log-card" key={log.id}>
                          <div className="sync-log-card-header">
                            <div>
                              <strong>{formatDateTime(log.started_at)}</strong>
                              <span>{log.sync_type} sync</span>
                            </div>
                            <span className={log.status === "Success" ? "badge ready" : "badge missing"}>{log.status}</span>
                          </div>
                          <div className="sync-log-stats">
                            <span>Checked <strong>{log.orders_checked}</strong></span>
                            <span>Inserted <strong>{log.orders_inserted}</strong></span>
                            <span>Updated <strong>{log.orders_updated}</strong></span>
                          </div>
                          <div className="sync-log-meta">
                            <span>Finished</span>
                            <strong>{formatDateTime(log.finished_at)}</strong>
                          </div>
                          {log.error_message ? (
                            <p className="sync-log-error">{log.error_message}</p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No sync logs yet.</p>
                  )}
                </div>
              </section>
            </details>

            <details className="settings-disclosure nested">
              <summary>
                <span>Recent courier tracking logs</span>
                <span className="badge ready">{trackingLogs.logs.length}</span>
              </summary>
              <section className="panel">
                <div className="panel-body">
                  {trackingLogs.error ? (
                    <div className="notice error">
                      <strong>Courier logs unavailable</strong>
                      <p>{trackingLogs.error}</p>
                    </div>
                  ) : trackingLogs.logs.length ? (
                    <div className="tracking-log-list">
                      {trackingLogs.logs.map((log) => (
                        <details className="tracking-log-card" key={log.id}>
                          <summary>
                            <span>
                              {formatDateTime(log.started_at)} · {log.check_source}
                            </span>
                            <span className={log.status === "Success" ? "badge ready" : "badge missing"}>{log.status}</span>
                          </summary>
                          <div className="result-grid">
                            <span>Checked: {log.orders_checked}</span>
                            <span>Updated: {log.orders_updated}</span>
                            <span>Failed: {log.orders_failed}</span>
                            <span>Skipped: {log.orders_skipped}</span>
                          </div>
                          <p className="muted">
                            Finished: {formatDateTime(log.finished_at)}
                            {log.error_message ? ` · Error: ${log.error_message}` : ""}
                          </p>
                          {log.items.length ? (
                            <div className="tracking-item-list">
                              {log.items.map((item) => (
                                <article className="tracking-item-card" key={item.id}>
                                  <div className="tracking-item-header">
                                    <strong>{item.order_name ?? "Unknown order"}</strong>
                                    <span className={item.status === "Failed" ? "badge missing" : "badge ready"}>{item.status}</span>
                                  </div>
                                  <div className="tracking-item-meta">
                                    <span>{item.courier_name ?? "No courier"}</span>
                                    <span>{item.tracking_id ?? "No tracking ID"}</span>
                                  </div>
                                  <dl className="tracking-item-change-grid">
                                    <div>
                                      <dt>Courier date</dt>
                                      <dd>
                                        {formatValue(item.previous_courier_date)} → {formatValue(item.fetched_courier_date)} →{" "}
                                        {formatValue(item.new_courier_date)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Delivery status</dt>
                                      <dd>
                                        {formatValue(item.previous_delivery_status)} → {formatValue(item.fetched_delivery_status)} →{" "}
                                        {formatValue(item.new_delivery_status)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt>Delivery date</dt>
                                      <dd>
                                        {formatValue(item.previous_delivery_date)} → {formatValue(item.fetched_delivery_date)} →{" "}
                                        {formatValue(item.new_delivery_date)}
                                      </dd>
                                    </div>
                                  </dl>
                                  {item.error_message ? (
                                    <p className="sync-log-error">{item.error_message}</p>
                                  ) : null}
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="muted">No per-order rows were logged for this run.</p>
                          )}
                        </details>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">No courier tracking logs yet.</p>
                  )}
                </div>
              </section>
            </details>
          </section>
          </SettingsDrawer>
          <a className="button secondary" href="/logout">Logout</a>
        </div>
      </header>

      {report.error ? (
        <section className="panel">
          <div className="panel-header">
            <h2>Orders Report</h2>
            <span className="badge missing">Unavailable</span>
          </div>
          <div className="panel-body">
            <div className="notice error">
              <strong>Report unavailable</strong>
              <p>{report.error}</p>
            </div>
          </div>
        </section>
      ) : (
        <OrdersReport
          currentDate={currentDate}
          deliveryDelayDays={appSettings.deliveryDelayDays}
          initialRows={report.rows}
          initialTotalRows={report.totalRows}
        />
      )}

    </>
  );
}
