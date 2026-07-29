"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Eye, Filter, Info, RefreshCw, Search, X } from "lucide-react";

import type { DuplicateTrackingEntry, OrdersReportSummary, ReportRow } from "@/lib/orders/report";
import { resolveTrackingUrl, supportedCourierOptions } from "@/lib/courier/tracking-links";
import { reportColumns } from "@/lib/report/columns";
import { statusOptions } from "@/lib/status-options";

type OrdersReportProps = {
  currentDate: string;
  deliveryDelayDays: number;
  initialEndDate: string;
  initialDuplicateTrackingEntries: DuplicateTrackingEntry[];
  initialRows: ReportRow[];
  initialSummary: OrdersReportSummary;
  initialStartDate: string;
  initialTotalRows: number;
};

type SortKey =
  | "date-desc"
  | "date-asc"
  | "order-desc"
  | "order-asc"
  | "name-asc"
  | "courier-asc"
  | "delivery-asc";

type Filters = {
  focusStatus: string;
  search: string;
  startDate: string;
  endDate: string;
  courierName: string;
  deliveryStatus: string;
  delayStatus: string;
};

type DateRangePreset = "today" | "last-7" | "last-14" | "last-30" | "this-month" | "last-month" | "custom";

type TableFilterKey = "focusStatus" | "search" | "courierName" | "deliveryStatus" | "delayStatus";

type ActiveFilterChip = {
  key: TableFilterKey;
  label: string;
  value: string;
};

type Draft = {
  courierDate: string;
  courierName: string;
  courierCharge: string;
  trackingId: string;
  trackingUrl: string;
  trackingStatus: string;
  deliveryDate: string;
  deliveryStatus: string;
  confirmText: string;
  trackingText: string;
  reviewText: string;
  reviewComment: string;
  courierComment: string;
};

type InlineMessageDraft = {
  courierCharge: string;
  confirmText: string;
  trackingText: string;
  reviewText: string;
  reviewComment: string;
  courierComment: string;
};

type SaveResponse = {
  ok: boolean;
  row?: ReportRow;
  message?: string;
  warning?: string | null;
};

type TrackingStatusCheckResponse = {
  ok: boolean;
  checked?: number;
  failed?: number;
  failures?: Array<{ orderId: string; reason: string }>;
  message?: string;
  rows?: ReportRow[];
  skipped?: number;
  updated?: number;
};

type ReportPageResponse = {
  ok: boolean;
  message?: string;
  duplicateTrackingEntries?: DuplicateTrackingEntry[];
  rows?: ReportRow[];
  summary?: OrdersReportSummary;
  totalRows?: number;
};

type TrackingPreviewDetails = {
  bookedAt: string | null;
  deliveredAt: string | null;
  destination: string | null;
  estimatedDeliveryDate: string | null;
  events: Array<{
    event: string;
    eventCode: string | null;
    location: string | null;
    nextLocation: string | null;
    remarks: string | null;
    trackedAt: string | null;
  }>;
  lastEventAt: string | null;
  lastUpdatedAt: string | null;
  origin: string | null;
  pieces: number | null;
  rawStatus: string;
  referenceNumber: string | null;
  scheduledDeliveryDate: string | null;
  weight: string | null;
};

type TrackingPreviewResponse = {
  details?: TrackingPreviewDetails | null;
  message?: string;
  ok: boolean;
  status?: {
    courierDate: string | null;
    deliveryDate: string | null;
    deliveryStatus: string;
    rawStatus: string;
    trackingProvider: string | null;
    trackingUrl: string | null;
    trackingStatus: string;
  };
};

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "order-desc", label: "Order high to low" },
  { value: "order-asc", label: "Order low to high" },
  { value: "name-asc", label: "Name A to Z" },
  { value: "courier-asc", label: "Courier A to Z" },
  { value: "delivery-asc", label: "Delivery status" }
];

const pageSizeOptions = [25, 50, 100, 250] as const;
const orderTableColumns = [
  "DATE",
  "ORDER ID",
  "NAME",
  "CITY",
  "COURIER",
  "TRACKING",
  "DELIVERY STATUS",
  "DELAYED",
  "REVIEW TXT",
  "DETAILS"
] as const;

const emptyFilters = {
  focusStatus: "",
  search: "",
  courierName: "",
  deliveryStatus: "",
  delayStatus: ""
} satisfies Omit<Filters, "startDate" | "endDate">;

const dateRangeOptions: Array<{ label: string; value: DateRangePreset }> = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "last-7" },
  { label: "Last 14 days", value: "last-14" },
  { label: "Last 30 days", value: "last-30" },
  { label: "This month", value: "this-month" },
  { label: "Last month", value: "last-month" },
  { label: "Custom", value: "custom" }
];

function isMessageSent(status: string) {
  return status === "Sent" || status === "Received";
}

function messageExportValue(status: string) {
  return isMessageSent(status) ? "Yes" : "No";
}

function reviewTxtLabel(status: string) {
  return isMessageSent(status) ? "Sent" : "Pending";
}

function deliveryStatusForRow(row: ReportRow) {
  if (!row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Not Shipped";
  }

  if (row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Tracking Added";
  }

  return row.deliveryStatus;
}

function deliveryStatusLabel(status: string) {
  return status === "Returned" ? "RTO" : status;
}

function dateOnlyTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function daysBetweenDates(startDate: string, endDate: string) {
  const start = dateOnlyTime(startDate);
  const end = dateOnlyTime(endDate);

  if (start === null || end === null) {
    return 0;
  }

  return Math.floor((end - start) / 86_400_000);
}

function isDelayedOrder(row: ReportRow, currentDate: string, deliveryDelayDays: number) {
  return Boolean(
    row.courierDate &&
      deliveryStatusForRow(row) !== "Delivered" &&
      daysBetweenDates(row.courierDate, currentDate) >= deliveryDelayDays
  );
}

function createDraft(row: ReportRow): Draft {
  return {
    courierDate: row.courierDate,
    courierName: row.courierName,
    courierCharge: row.courierCharge === null ? "" : String(row.courierCharge),
    trackingId: row.trackingId,
    trackingUrl: row.trackingUrl,
    trackingStatus: row.trackingStatus,
    deliveryDate: row.deliveryDate,
    deliveryStatus: row.deliveryStatus,
    confirmText: row.confirmText,
    trackingText: row.trackingText,
    reviewText: row.reviewText,
    reviewComment: row.reviewComments,
    courierComment: row.courierComments
  };
}

function csvEscape(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function nextActionForRow(row: ReportRow, currentDate: string, deliveryDelayDays: number) {
  const deliveryStatus = deliveryStatusForRow(row);

  if (deliveryStatus === "Not Shipped") {
    return {
      title: "Fulfill in Shopify",
      detail: "This order has no tracking ID yet, so it is not ready for courier follow-up."
    };
  }

  if (isDelayedOrder(row, currentDate, deliveryDelayDays)) {
    return {
      title: "Call courier / customer",
      detail: `Courier date is ${deliveryDelayDays}+ days old and the order is not delivered.`
    };
  }

  if (row.trackingId && deliveryStatus !== "Delivered") {
    return {
      title: "Check courier status",
      detail: "Tracking ID exists. Refresh the latest courier status before calling."
    };
  }

  if (deliveryStatus === "Delivered" && !isMessageSent(row.reviewText)) {
    return {
      title: "Send review TXT",
      detail: "Delivery is complete, but review follow-up is still pending."
    };
  }

  return {
    title: "No urgent action",
    detail: "This order does not currently need immediate follow-up."
  };
}

function csvValueForColumn(
  row: ReportRow,
  column: (typeof reportColumns)[number],
  currentDate: string,
  deliveryDelayDays: number
) {
  const values = {
    DATE: row.date,
    "ORDER ID": row.orderId,
    NAME: row.name,
    CITY: cityStateLabel(row),
    "COURIER DATE": row.courierDate,
    "COURIER NAME": row.courierName,
    "COURIER CHARGE": row.courierCharge,
    "TRACKING ID": row.trackingId,
    "REVIEW TXT": messageExportValue(row.reviewText),
    "DELIVERY DATE": row.deliveryDate,
    "DELIVERY STATUS": deliveryStatusLabel(deliveryStatusForRow(row)),
    DELAYED: isDelayedOrder(row, currentDate, deliveryDelayDays) ? "Yes" : "No",
    "REVIEW COMMENTS": row.reviewComments
  } satisfies Record<(typeof reportColumns)[number], string | number | null>;

  return values[column];
}

function buildExportFilename(filters: Filters) {
  const datePart = filters.startDate || filters.endDate ? `${filters.startDate || "start"}_to_${filters.endDate || "end"}` : "visible";
  return `shopify-orders-${datePart}.csv`;
}

function addDaysToDateInput(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDateRangeForPreset(preset: Exclude<DateRangePreset, "custom">, currentDate: string) {
  if (preset === "today") {
    return {
      endDate: currentDate,
      startDate: currentDate
    };
  }

  if (preset === "this-month") {
    return {
      endDate: currentDate,
      startDate: `${currentDate.slice(0, 8)}01`
    };
  }

  if (preset === "last-month") {
    const [year, month] = currentDate.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));

    return {
      endDate: formatDateInput(end),
      startDate: formatDateInput(start)
    };
  }

  if (preset === "last-14") {
    return {
      endDate: currentDate,
      startDate: addDaysToDateInput(currentDate, -13)
    };
  }

  if (preset === "last-30") {
    return {
      endDate: currentDate,
      startDate: addDaysToDateInput(currentDate, -29)
    };
  }

  return {
    endDate: currentDate,
    startDate: addDaysToDateInput(currentDate, -6)
  };
}

function trackingUrlForRow(row: ReportRow) {
  return resolveTrackingUrl(row.courierName, row.trackingId, row.trackingUrl);
}

function formatDateTime(value: string) {
  if (!value) {
    return "Never checked";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function formatOrderDate(value: string) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00+05:30`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

function formatTrackingDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatOrderDate(value);
  }

  return formatDateTime(value);
}

function courierScanLabel(row: ReportRow) {
  if (deliveryStatusForRow(row) === "Delivered") {
    return row.deliveryDate ? `Delivered ${formatOrderDate(row.deliveryDate)}` : "Delivered";
  }

  if (deliveryStatusForRow(row) === "Returned") {
    return row.deliveryDate ? `RTO ${formatOrderDate(row.deliveryDate)}` : "RTO";
  }

  if (!row.courierName) {
    return "Not shipped yet";
  }

  return row.courierDate ? `Shipped ${formatOrderDate(row.courierDate)}` : "Waiting for courier scan";
}

function deliveryStatusMetaLabel(row: ReportRow) {
  if (deliveryStatusForRow(row) === "Delivered") {
    return row.deliveryDate ? `Delivered ${formatOrderDate(row.deliveryDate)}` : "";
  }

  if (deliveryStatusForRow(row) === "Returned") {
    return row.deliveryDate ? `RTO ${formatOrderDate(row.deliveryDate)}` : "RTO";
  }

  return trackingCheckLabel(row);
}

function trackingCheckLabel(row: ReportRow) {
  if (!row.trackingId) {
    return "";
  }

  return row.trackingCheckedAt ? `Checked ${formatDateTime(row.trackingCheckedAt)}` : "Not checked yet";
}

function trackingProviderLabel(provider: string | null | undefined) {
  return provider?.trim() || "";
}

function cityStateLabel(row: ReportRow) {
  return [row.city, row.state].filter(Boolean).join(", ") || "-";
}

function stickyClassForColumn(column: string) {
  if (column === "DATE") return "sticky-col sticky-col-1";
  if (column === "ORDER ID") return "sticky-col sticky-col-2";
  if (column === "NAME") return "sticky-col sticky-col-3";
  return "";
}

export function OrdersReport({
  currentDate,
  deliveryDelayDays,
  initialEndDate,
  initialDuplicateTrackingEntries,
  initialRows,
  initialSummary,
  initialStartDate,
  initialTotalRows
}: OrdersReportProps) {
  const [rows, setRows] = useState(initialRows);
  const [rangeSummary, setRangeSummary] = useState(initialSummary);
  const [duplicateTrackingEntries, setDuplicateTrackingEntries] = useState(initialDuplicateTrackingEntries);
  const [totalRows, setTotalRows] = useState(initialTotalRows);
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("last-7");
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters,
    endDate: initialEndDate,
    startDate: initialStartDate
  });
  const [sortKey, setSortKey] = useState<SortKey>("date-desc");
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(100);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingPage, setLoadingPage] = useState(false);
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, InlineMessageDraft>>({});
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set());
  const [checkingRowIds, setCheckingRowIds] = useState<Set<string>>(() => new Set());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [trackingPreviewOrderId, setTrackingPreviewOrderId] = useState<string | null>(null);
  const [trackingPreviewData, setTrackingPreviewData] = useState<{ orderId: string; response: TrackingPreviewResponse } | null>(null);
  const [trackingPreviewError, setTrackingPreviewError] = useState<string | null>(null);
  const [trackingPreviewLoading, setTrackingPreviewLoading] = useState(false);
  const [trackingPreviewReloadToken, setTrackingPreviewReloadToken] = useState(0);
  const [notice, setNotice] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  const [drawerNotice, setDrawerNotice] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  useEffect(() => {
    function reloadReport() {
      setReloadToken((value) => value + 1);
    }

    window.addEventListener("orders-report-refresh", reloadReport);
    return () => window.removeEventListener("orders-report-refresh", reloadReport);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      currentDate,
      deliveryDelayDays: String(deliveryDelayDays),
      page: String(page),
      pageSize: String(pageSize),
      sortKey
    });

    if (filters.courierName) params.set("courierName", filters.courierName);
    if (filters.deliveryStatus) params.set("deliveryStatus", filters.deliveryStatus);
    if (filters.delayStatus) params.set("delayStatus", filters.delayStatus);
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.focusStatus) params.set("focusStatus", filters.focusStatus);
    if (filters.search.trim()) params.set("search", filters.search.trim());

    async function loadPage() {
      setLoadingPage(true);

      try {
        const response = await fetch(`/api/orders/report?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const data = (await response.json()) as ReportPageResponse;

        if (!response.ok || !data.ok || !data.rows) {
          throw new Error(data.message ?? "Could not load this page.");
        }

        setRows(data.rows);
        setDuplicateTrackingEntries(data.duplicateTrackingEntries ?? []);
        setTotalRows(data.totalRows ?? data.rows.length);
        setRangeSummary(data.summary ?? {
          delayed: 0,
          delivered: 0,
          inTransit: 0,
          notShipped: 0,
          reviewPending: 0,
          total: data.totalRows ?? data.rows.length
        });
        setSelectedOrderId((current) => (current && data.rows?.some((row) => row.id === current) ? current : null));
        setTrackingPreviewOrderId((current) => (current && data.rows?.some((row) => row.id === current) ? current : null));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Could not load this page."
        });
      } finally {
        if (!controller.signal.aborted) {
          setLoadingPage(false);
        }
      }
    }

    void loadPage();

    return () => controller.abort();
  }, [
    currentDate,
    deliveryDelayDays,
    filters.courierName,
    filters.deliveryStatus,
    filters.delayStatus,
    filters.endDate,
    filters.focusStatus,
    filters.search,
    filters.startDate,
    page,
    pageSize,
    reloadToken,
    sortKey
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows;
  const selectedRow = useMemo(
    () => (selectedOrderId ? rows.find((row) => row.id === selectedOrderId) ?? null : null),
    [rows, selectedOrderId]
  );
  const trackingPreviewRow = useMemo(
    () => (trackingPreviewOrderId ? rows.find((row) => row.id === trackingPreviewOrderId) ?? null : null),
    [rows, trackingPreviewOrderId]
  );

  useEffect(() => {
    if (!trackingPreviewRow?.trackingId) {
      return;
    }

    const controller = new AbortController();
    const previewOrderId = trackingPreviewRow.id;

    async function loadTrackingPreview() {
      setTrackingPreviewLoading(true);
      setTrackingPreviewData(null);
      setTrackingPreviewError(null);

      try {
        const response = await fetch("/api/tracking/preview", {
          body: JSON.stringify({ orderId: previewOrderId }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST",
          signal: controller.signal
        });
        const data = (await response.json()) as TrackingPreviewResponse;

        if (!response.ok || !data.ok) {
          throw new Error(data.message ?? "Could not load tracking page details.");
        }

        setTrackingPreviewData({ orderId: previewOrderId, response: data });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setTrackingPreviewData(null);
        setTrackingPreviewError(error instanceof Error ? error.message : "Could not load tracking page details.");
      } finally {
        if (!controller.signal.aborted) {
          setTrackingPreviewLoading(false);
        }
      }
    }

    void loadTrackingPreview();

    return () => controller.abort();
  }, [trackingPreviewReloadToken, trackingPreviewRow?.id, trackingPreviewRow?.trackingId]);

  const selectedRangeLabel = dateRangeOptions.find((option) => option.value === dateRangePreset)?.label ?? "Custom";
  const defaultDateRange = getDateRangeForPreset("last-7", currentDate);
  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];

    if (filters.search.trim()) chips.push({ key: "search", label: "Search", value: filters.search.trim() });
    if (filters.courierName) chips.push({ key: "courierName", label: "Courier", value: filters.courierName });
    if (filters.deliveryStatus) chips.push({ key: "deliveryStatus", label: "Delivery", value: filters.deliveryStatus });
    if (filters.delayStatus === "delayed") chips.push({ key: "delayStatus", label: "Delay", value: "Delayed" });
    if (filters.delayStatus === "not-delayed") chips.push({ key: "delayStatus", label: "Delay", value: "Not delayed" });
    if (filters.focusStatus === "moving") chips.push({ key: "focusStatus", label: "Dashboard", value: "In Transit" });
    if (filters.focusStatus === "review-pending") chips.push({ key: "focusStatus", label: "Dashboard", value: "Review Pending" });

    return chips;
  }, [filters]);
  const hasTableFilters = activeFilterChips.length > 0;
  const isDefaultView =
    dateRangePreset === "last-7" &&
    filters.startDate === defaultDateRange.startDate &&
    filters.endDate === defaultDateRange.endDate &&
    !hasTableFilters &&
    sortKey === "date-desc" &&
    pageSize === 100;

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearTableFilters() {
    setFilters((current) => ({
      ...current,
      ...emptyFilters
    }));
    setSortKey("date-desc");
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function removeTableFilter(key: TableFilterKey) {
    setFilters((current) => ({
      ...current,
      [key]: ""
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function updateCustomDate(key: "startDate" | "endDate", value: string) {
    setDateRangePreset("custom");
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate,
      [key]: value
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function inlineDraftFor(row: ReportRow) {
    return inlineDrafts[row.id] ?? {
      courierCharge: row.courierCharge === null ? "" : String(row.courierCharge),
      confirmText: row.confirmText,
      trackingText: row.trackingText,
      reviewText: row.reviewText,
      reviewComment: row.reviewComments,
      courierComment: row.courierComments
    };
  }

  function updateInlineDraft(row: ReportRow, key: keyof InlineMessageDraft, value: string) {
    setInlineDrafts((current) => ({
      ...current,
      [row.id]: {
        ...(current[row.id] ?? {
          courierCharge: row.courierCharge === null ? "" : String(row.courierCharge),
          confirmText: row.confirmText,
          trackingText: row.trackingText,
          reviewText: row.reviewText,
          reviewComment: row.reviewComments,
          courierComment: row.courierComments
        }),
        [key]: value
      }
    }));
  }

  function clearInlineDraft(rowId: string) {
    setInlineDrafts((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  }

  function setRowSaving(rowId: string, saving: boolean) {
    setSavingRowIds((current) => {
      const next = new Set(current);

      if (saving) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }

      return next;
    });
  }

  function setRowChecking(rowId: string, checking: boolean) {
    setCheckingRowIds((current) => {
      const next = new Set(current);

      if (checking) {
        next.add(rowId);
      } else {
        next.delete(rowId);
      }

      return next;
    });
  }

  function clearFilters() {
    setDateRangePreset("last-7");
    setFilters({
      ...emptyFilters,
      ...getDateRangeForPreset("last-7", currentDate)
    });
    setSortKey("date-desc");
    setPageSize(100);
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function showAllInCurrentRange() {
    clearTableFilters();
  }

  function closeOrderDetails() {
    setDrawerNotice(null);
    setSelectedOrderId(null);
  }

  function showDelayedOrders() {
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate,
      delayStatus: current.delayStatus === "delayed" ? "" : "delayed"
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function showDeliveryStatus(deliveryStatus: string) {
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate,
      deliveryStatus: current.deliveryStatus === deliveryStatus ? "" : deliveryStatus
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function showReviewPending() {
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate,
      focusStatus: current.focusStatus === "review-pending" ? "" : "review-pending"
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function showMovingOrders() {
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate,
      focusStatus: current.focusStatus === "moving" ? "" : "moving"
    }));
    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function setDateRange(range: DateRangePreset) {
    setDateRangePreset(range);

    setFilters((current) => ({
      ...emptyFilters,
      ...(range === "custom"
        ? { endDate: current.endDate, startDate: current.startDate }
        : getDateRangeForPreset(range, currentDate))
    }));

    setPage(1);
    setSelectedOrderId(null);
    setNotice(null);
  }

  function exportFilteredRows() {
    if (!pageRows.length) {
      setNotice({ type: "error", message: "There are no visible rows to export." });
      return;
    }

    const csv = [
      reportColumns.map(csvEscape).join(","),
      ...pageRows.map((row) =>
        reportColumns
          .map((column) => csvEscape(csvValueForColumn(row, column, currentDate, deliveryDelayDays)))
          .join(",")
      )
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExportFilename(filters);
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ type: "success", message: `Exported ${pageRows.length} rows from this page.` });
  }

  function showRowNotice(
    rowId: string,
    value: { type: "success" | "warning" | "error"; message: string } | null
  ) {
    if (selectedOrderId === rowId) {
      setDrawerNotice(value);
    } else {
      setNotice(value);
    }
  }

  async function saveOrderDraft(row: ReportRow, nextDraft: Draft, successMessage: string) {
    setRowSaving(row.id, true);
    showRowNotice(row.id, null);

    try {
      if (nextDraft.courierCharge && !/^\d+(\.\d+)?$/.test(nextDraft.courierCharge)) {
        throw new Error("Courier charge must be a valid non-negative number.");
      }

      const response = await fetch(`/api/orders/${row.id}/operations`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...nextDraft,
          changedBy: "Local Admin"
        })
      });
      const data = (await response.json()) as SaveResponse;

      if (!response.ok || !data.ok || !data.row) {
        throw new Error(data.message ?? "Could not save order updates.");
      }

      const savedRow = data.row;
      setRows((current) => current.map((row) => (row.id === savedRow.id ? savedRow : row)));
      clearInlineDraft(savedRow.id);
      showRowNotice(row.id, {
        type: data.warning ? "warning" : "success",
        message: data.warning ?? successMessage
      });
    } catch (error) {
      showRowNotice(row.id, {
        type: "error",
        message: error instanceof Error ? error.message : "Could not save order updates."
      });
      throw error;
    } finally {
      setRowSaving(row.id, false);
    }
  }

  async function saveInlineFields(row: ReportRow, overrides: Partial<InlineMessageDraft> = {}) {
    const current = {
      ...inlineDraftFor(row),
      ...overrides
    };

    if (
      current.courierCharge === (row.courierCharge === null ? "" : String(row.courierCharge)) &&
      current.confirmText === row.confirmText &&
      current.trackingText === row.trackingText &&
      current.reviewText === row.reviewText &&
      current.reviewComment.trim() === row.reviewComments.trim() &&
      current.courierComment.trim() === row.courierComments.trim()
    ) {
      clearInlineDraft(row.id);
      return;
    }

    try {
      await saveOrderDraft(
        row,
        {
          ...createDraft(row),
          courierCharge: current.courierCharge,
          confirmText: current.confirmText,
          trackingText: current.trackingText,
          reviewText: current.reviewText,
          reviewComment: current.reviewComment,
          courierComment: current.courierComment
        },
        `Saved order fields for ${row.orderId}.`
      );
    } catch {
      // The shared save helper already shows the specific error notice.
    }
  }

  async function checkDeliveryStatusesForRows(targetRows: ReportRow[], options: { bulk: boolean }) {
    const targetRow = targetRows[0];
    const singleRow = !options.bulk && targetRow ? targetRow : null;
    if (singleRow) {
      showRowNotice(singleRow.id, null);
    } else {
      setNotice(null);
    }

    try {
      const response = await fetch("/api/tracking/check-status", {
        body: JSON.stringify({
          orderIds: options.bulk ? [] : targetRows.map((row) => row.id)
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const data = (await response.json()) as TrackingStatusCheckResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.message ?? "Could not check delivery statuses.");
      }

      if (data.rows?.length) {
        setRows((current) => {
          const rowById = new Map(data.rows?.map((row) => [row.id, row]) ?? []);
          return current.map((row) => rowById.get(row.id) ?? row);
        });
      }

      const orderNameById = new Map(rows.map((row) => [row.id, row.orderId]));
      const failedText = data.failed ? ` ${data.failed} failed.` : "";
      const failureDetails = data.failures?.length
        ? ` Failed: ${data.failures
            .slice(0, 3)
            .map((failure) => `${orderNameById.get(failure.orderId) ?? failure.orderId}: ${failure.reason}`)
            .join(" | ")}${data.failures.length > 3 ? " ..." : ""}`
        : "";
      const skippedText = data.skipped ? ` ${data.skipped} skipped.` : "";
      const targetText = options.bulk ? "all pending courier rows" : targetRows[0]?.orderId ?? "order";
      const nextNotice = {
        type: data.failed ? "warning" : "success",
        message: `Checked ${targetText}. Checked ${data.checked ?? 0}. Updated ${data.updated ?? 0}.${failedText}${skippedText}${failureDetails}`
      } as const;
      if (singleRow) {
        showRowNotice(singleRow.id, nextNotice);
      } else {
        setNotice(nextNotice);
      }
    } catch (error) {
      const nextNotice = {
        type: "error",
        message: error instanceof Error ? error.message : "Could not check delivery statuses."
      } as const;
      if (singleRow) {
        showRowNotice(singleRow.id, nextNotice);
      } else {
        setNotice(nextNotice);
      }
      throw error;
    }
  }

  async function checkSingleDeliveryStatus(row: ReportRow) {
    if (!row.trackingId.trim()) {
      showRowNotice(row.id, { type: "error", message: `${row.orderId} does not have a tracking ID.` });
      return;
    }

    if (row.deliveryStatus === "Delivered" && row.courierDate) {
      showRowNotice(row.id, { type: "success", message: `${row.orderId} is already marked delivered.` });
      return;
    }

    setRowChecking(row.id, true);

    try {
      await checkDeliveryStatusesForRows([row], { bulk: false });
    } catch {
      // The shared checker already shows the specific error notice.
    } finally {
      setRowChecking(row.id, false);
    }
  }

  return (
    <>
      <section className="dashboard-date-filter" aria-label="Dashboard date range">
        <div>
          <p className="eyebrow">Time Filter</p>
          <h2>Dashboard and table use this range</h2>
        </div>
        <div className="dashboard-date-fields">
          <label className="field compact">
            <span>Range</span>
            <select value={dateRangePreset} onChange={(event) => setDateRange(event.target.value as DateRangePreset)}>
              {dateRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {dateRangePreset === "custom" ? (
            <>
              <label className="field compact">
                <span>Start</span>
                <input type="date" value={filters.startDate} onChange={(event) => updateCustomDate("startDate", event.target.value)} />
              </label>
              <label className="field compact">
                <span>End</span>
                <input type="date" value={filters.endDate} onChange={(event) => updateCustomDate("endDate", event.target.value)} />
              </label>
            </>
          ) : null}
        </div>
      </section>

      <section className="ops-summary" aria-label="Operational priorities">
        <button className="ops-card" type="button" onClick={showAllInCurrentRange}>
          <span>Total Orders</span>
          <strong>{rangeSummary.total}</strong>
          <small>Selected range · clear table filters</small>
        </button>
        <button className={`ops-card urgent ${filters.delayStatus === "delayed" ? "active" : ""}`} type="button" onClick={showDelayedOrders}>
          <span>Delayed</span>
          <strong>{rangeSummary.delayed}</strong>
          <small>{deliveryDelayDays}+ days after courier date</small>
        </button>
        <button
          className={`ops-card ${filters.deliveryStatus === "Not Shipped" ? "active" : ""}`}
          type="button"
          onClick={() => showDeliveryStatus("Not Shipped")}
        >
          <span>Not Shipped</span>
          <strong>{rangeSummary.notShipped}</strong>
          <small>Needs fulfillment/tracking</small>
        </button>
        <button
          className={`ops-card ${filters.focusStatus === "moving" ? "active" : ""}`}
          type="button"
          onClick={showMovingOrders}
        >
          <span>In Transit</span>
          <strong>{rangeSummary.inTransit}</strong>
          <small>Tracking added or moving</small>
        </button>
        <button
          className={`ops-card ${filters.deliveryStatus === "Delivered" ? "active" : ""}`}
          type="button"
          onClick={() => showDeliveryStatus("Delivered")}
        >
          <span>Delivered</span>
          <strong>{rangeSummary.delivered}</strong>
          <small>Completed shipments</small>
        </button>
        <button
          className={`ops-card ${filters.focusStatus === "review-pending" ? "active" : ""}`}
          type="button"
          onClick={showReviewPending}
        >
          <span>Review Pending</span>
          <strong>{rangeSummary.reviewPending}</strong>
          <small>Needs review TXT</small>
        </button>
      </section>

      <div className="toolbar" aria-label="Report actions">
        <div className={`search-field ${filters.search.trim() ? "has-value" : ""}`}>
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="Search by order, customer, city, courier, or tracking ID"
            placeholder="Search order, customer, city, courier, tracking"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
          {filters.search.trim() ? (
            <button
              aria-label="Clear search"
              className="search-clear-button"
              type="button"
              onClick={() => removeTableFilter("search")}
            >
              <X aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
        <button className="button" type="button" onClick={exportFilteredRows}>
          <Download aria-hidden="true" size={18} />
          Export
        </button>
      </div>

      <section className="active-filter-bar" aria-label="Active report filters">
        <div className="active-filter-copy">
          <span className="active-range-chip">
            Range: {selectedRangeLabel} · {filters.startDate || "Start"} to {filters.endDate || "Today"}
          </span>
          {hasTableFilters ? (
            activeFilterChips.map((chip) => (
              <button
                className="active-filter-chip removable"
                key={`${chip.key}-${chip.value}`}
                type="button"
                onClick={() => removeTableFilter(chip.key)}
              >
                <span>{chip.label}: {chip.value}</span>
                <X aria-hidden="true" size={13} />
              </button>
            ))
          ) : (
            <span className="active-filter-empty">No table filters active</span>
          )}
        </div>
        <div className="active-filter-actions">
          {hasTableFilters ? (
            <button className="button secondary compact-action" type="button" onClick={clearTableFilters}>
              <X aria-hidden="true" size={16} />
              Clear table filters
            </button>
          ) : null}
          {!isDefaultView ? (
            <button className="button secondary compact-action" type="button" onClick={clearFilters}>
              Reset default view
            </button>
          ) : null}
        </div>
      </section>

      {loadingPage ? (
        <div className="running-state">
          <RefreshCw aria-hidden="true" className="spin" size={18} />
          <div>
            <strong>Loading page {page}</strong>
            <p>Fetching only this page of orders from Supabase.</p>
          </div>
        </div>
      ) : null}

      {duplicateTrackingEntries.length ? (
        <div className="notice warning">
          <strong>Duplicate tracking IDs found</strong>
          <p>{duplicateTrackingEntries.length} tracking ID{duplicateTrackingEntries.length === 1 ? "" : "s"} appear on multiple orders in the current filtered result.</p>
          <div className="duplicate-tracking-list">
            {duplicateTrackingEntries.slice(0, 5).map((entry) => (
              <button
                className="duplicate-tracking-chip"
                key={entry.trackingId}
                type="button"
                onClick={() => updateFilter("search", entry.trackingId)}
              >
                <strong>{entry.trackingId}</strong>
                <span>{entry.orderIds.join(", ")}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <section className="filter-console" aria-label="Report filters">
        <div className="filter-console-header">
          <div>
            <p className="eyebrow">Table Controls</p>
            <h2>Sort, page, and refine orders</h2>
          </div>
          <div className="filter-console-count">
            <strong>{totalRows}</strong>
            <span>matching orders</span>
          </div>
        </div>

        <div className="filter-grid">
          <label className="field compact">
            <span>Sort by</span>
            <select value={sortKey} onChange={(event) => {
              setSortKey(event.target.value as SortKey);
              setPage(1);
            }}>
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(event) => {
              setPageSize(Number(event.target.value) as typeof pageSize);
              setPage(1);
            }}>
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className={`field compact ${filters.courierName ? "active-select-field" : ""}`}>
            <span>Courier</span>
            <select value={filters.courierName} onChange={(event) => updateFilter("courierName", event.target.value)}>
              <option value="">Any courier</option>
              {supportedCourierOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={`field compact ${filters.deliveryStatus ? "active-select-field" : ""}`}>
            <span>Delivery Status</span>
            <select value={filters.deliveryStatus} onChange={(event) => updateFilter("deliveryStatus", event.target.value)}>
              <option value="">Any</option>
              {statusOptions.delivery.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className={`field compact ${filters.delayStatus ? "active-select-field" : ""}`}>
            <span>Delay</span>
            <select value={filters.delayStatus} onChange={(event) => updateFilter("delayStatus", event.target.value)}>
              <option value="">Any</option>
              <option value="delayed">Delayed</option>
              <option value="not-delayed">Not delayed</option>
            </select>
          </label>
        </div>

        <p className="filter-console-hint">
          These controls apply inside the selected date range. Active filters appear above the table and can be removed one by one.
        </p>
      </section>

      {notice ? (
        <div className={`notice ${notice.type}`}>
          <strong>
            {notice.type === "success" ? "Saved" : null}
            {notice.type === "warning" ? "Warning" : null}
            {notice.type === "error" ? "Update failed" : null}
          </strong>
          <p>{notice.message}</p>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Orders Report</h2>
          <span className="badge ready">{pageRows.length} shown · {totalRows} matching orders</span>
        </div>
        <div className="table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                {orderTableColumns.map((column) => (
                  <th className={stickyClassForColumn(column)} key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? (
                pageRows.map((row) => {
                  const deliveryStatus = deliveryStatusForRow(row);
                  const delayed = isDelayedOrder(row, currentDate, deliveryDelayDays);
                  const rowIsChecking = checkingRowIds.has(row.id);
                  const trackingUrl = trackingUrlForRow(row);
                  const deliveryMeta = deliveryStatusMetaLabel(row);
                  const inlineDraft = inlineDraftFor(row);

                  return (
                    <tr key={row.id}>
                      <td className="sticky-col sticky-col-1">{row.date}</td>
                      <td className="sticky-col sticky-col-2">{row.orderId}</td>
                      <td className="sticky-col sticky-col-3">{row.name || "-"}</td>
                      <td>
                        <div className="stacked-cell">
                          <strong>{row.city || "-"}</strong>
                          {row.state ? <span>{row.state}</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className="stacked-cell">
                          <strong>{row.courierName || "No courier"}</strong>
                          <span>{courierScanLabel(row)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="stacked-cell">
                          {trackingUrl ? (
                            <a className="table-link" href={trackingUrl} rel="noreferrer" target="_blank">
                              {row.trackingId || "Open tracking"}
                            </a>
                          ) : (
                            <strong>{row.trackingId || "-"}</strong>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="delivery-status-cell">
                          <div className="delivery-status-main">
                            <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>
                              {deliveryStatusLabel(deliveryStatus)}
                            </span>
                            {trackingUrl ? (
                              <button
                                aria-label={`Preview tracking page for ${row.orderId}`}
                                className="tracking-preview-button"
                                type="button"
                                onClick={() => setTrackingPreviewOrderId(row.id)}
                              >
                                <Eye aria-hidden="true" size={14} />
                              </button>
                            ) : null}
                          </div>
                          {deliveryMeta ? <span className="status-meta">{deliveryMeta}</span> : null}
                        </div>
                      </td>
                      <td>
                        {delayed ? (
                          <span className="status-pill delayed">Delayed</span>
                        ) : (
                          <span className="muted-text">No</span>
                        )}
                      </td>
                      <td>
                        <label className="review-txt-checkbox">
                          <input
                            aria-label={`Review TXT for ${row.orderId}`}
                            checked={isMessageSent(inlineDraft.reviewText)}
                            disabled={savingRowIds.has(row.id)}
                            type="checkbox"
                            onChange={(event) => {
                              const reviewText = event.target.checked ? "Sent" : "Pending";
                              updateInlineDraft(row, "reviewText", reviewText);
                              void saveInlineFields(row, { reviewText });
                            }}
                          />
                          <span>{reviewTxtLabel(inlineDraft.reviewText)}</span>
                        </label>
                      </td>
                      <td>
                        <div className="row-actions">
                          {row.trackingId && deliveryStatus !== "Delivered" ? (
                            <button
                              aria-label={`Check delivery status for ${row.orderId}`}
                              className="mini-button"
                              disabled={rowIsChecking}
                              type="button"
                              onClick={() => {
                                void checkSingleDeliveryStatus(row);
                              }}
                            >
                              <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={13} />
                              {rowIsChecking ? "Checking" : "Check"}
                            </button>
                          ) : null}
                  <button
                    className="mini-button primary"
                    type="button"
                    onClick={() => {
                      setDrawerNotice(null);
                      setSelectedOrderId(row.id);
                    }}
                  >
                            <Info aria-hidden="true" size={13} />
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="empty-row" colSpan={orderTableColumns.length}>
                    <div className="empty-state">
                      <strong>No orders match these filters</strong>
                      <p>Try clearing filters, widening the date range, or checking a different courier/status.</p>
                      <button className="button secondary" type="button" onClick={clearFilters}>
                        Reset default view
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-order-list">
          {pageRows.length ? (
            pageRows.map((row) => {
              const deliveryStatus = deliveryStatusForRow(row);
              const delayed = isDelayedOrder(row, currentDate, deliveryDelayDays);
              const rowIsChecking = checkingRowIds.has(row.id);
              const trackingUrl = trackingUrlForRow(row);
              const deliveryMeta = deliveryStatusMetaLabel(row);
              const inlineDraft = inlineDraftFor(row);

              return (
                <article className="mobile-order-card" key={row.id}>
                  <div className="mobile-order-card-header">
                    <div>
                      <span>{row.date}</span>
                      <strong>{row.orderId}</strong>
                      <small>{row.name || "No customer name"} · {cityStateLabel(row)}</small>
                    </div>
                    <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>
                      {deliveryStatusLabel(deliveryStatus)}
                    </span>
                  </div>
                  {deliveryMeta ? <span className="status-meta">{deliveryMeta}</span> : null}
                  <div className="mobile-order-card-grid">
                    <div>
                      <span>Courier</span>
                      <strong>{row.courierName || "No courier"}</strong>
                    </div>
                    <div>
                      <span>Shipment</span>
                      <strong>{courierScanLabel(row)}</strong>
                    </div>
                    <div>
                      <span>Tracking</span>
                      <strong>{row.trackingId || "-"}</strong>
                    </div>
                    <div>
                      <span>Tracking check</span>
                      <strong>{trackingCheckLabel(row) || "No tracking yet"}</strong>
                      {trackingProviderLabel(row.trackingProvider) ? <small>From {trackingProviderLabel(row.trackingProvider)}</small> : null}
                    </div>
                  </div>
                  {delayed ? <span className="status-pill delayed">Delayed</span> : null}
                  <label className="review-txt-checkbox mobile-review-txt-checkbox">
                    <input
                      aria-label={`Review TXT for ${row.orderId}`}
                      checked={isMessageSent(inlineDraft.reviewText)}
                      disabled={savingRowIds.has(row.id)}
                      type="checkbox"
                      onChange={(event) => {
                        const reviewText = event.target.checked ? "Sent" : "Pending";
                        updateInlineDraft(row, "reviewText", reviewText);
                        void saveInlineFields(row, { reviewText });
                      }}
                    />
                    <span>Review TXT {reviewTxtLabel(inlineDraft.reviewText)}</span>
                  </label>
                  <div className="row-actions">
                    {trackingUrl ? (
                      <button className="mini-button" type="button" onClick={() => setTrackingPreviewOrderId(row.id)}>
                        <Eye aria-hidden="true" size={13} />
                        Preview Tracking
                      </button>
                    ) : null}
                    {row.trackingId && deliveryStatus !== "Delivered" ? (
                      <button
                        aria-label={`Check delivery status for ${row.orderId}`}
                        className="mini-button"
                        disabled={rowIsChecking}
                        type="button"
                        onClick={() => {
                          void checkSingleDeliveryStatus(row);
                        }}
                      >
                        <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={13} />
                        {rowIsChecking ? "Checking" : "Check"}
                      </button>
                    ) : null}
                    <button
                      className="mini-button primary"
                      type="button"
                      onClick={() => {
                        setDrawerNotice(null);
                        setSelectedOrderId(row.id);
                      }}
                    >
                      <Info aria-hidden="true" size={13} />
                      Details
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <strong>No orders match these filters</strong>
              <p>Try clearing filters, widening the date range, or checking a different courier/status.</p>
              <button className="button secondary" type="button" onClick={clearFilters}>
                Reset default view
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="filter-summary">
        <Filter aria-hidden="true" size={16} />
        <span>
          Showing {pageRows.length} row{pageRows.length === 1 ? "" : "s"} on page {safePage}. {totalRows} order{totalRows === 1 ? "" : "s"} match the current filters.
        </span>
        <div className="pagination">
          <button className="icon-button" type="button" disabled={loadingPage || safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))} aria-label="Previous page">
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <span>Page {safePage} of {totalPages}</span>
          <button className="icon-button" type="button" disabled={loadingPage || safePage >= totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))} aria-label="Next page">
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </div>

      {selectedRow ? (
        <div className="order-detail-layer">
          <button
            aria-label="Close order details"
            className="order-detail-scrim"
            type="button"
            onClick={closeOrderDetails}
          />
          {(() => {
            const inlineDraft = inlineDraftFor(selectedRow);
            const deliveryStatus = deliveryStatusForRow(selectedRow);
            const delayed = isDelayedOrder(selectedRow, currentDate, deliveryDelayDays);
            const rowIsChecking = checkingRowIds.has(selectedRow.id);
            const rowIsSaving = savingRowIds.has(selectedRow.id);
            const trackingUrl = trackingUrlForRow(selectedRow);
            const nextAction = nextActionForRow(selectedRow, currentDate, deliveryDelayDays);

            return (
              <aside className="order-detail-drawer" aria-label={`Details for ${selectedRow.orderId}`}>
                <div className="order-detail-header">
                  <div>
                    <p className="eyebrow">Order Details</p>
                    <h2>{selectedRow.orderId}</h2>
                    <p>{selectedRow.name || "No customer name"} · {cityStateLabel(selectedRow)}</p>
                  </div>
                  <button className="icon-button" type="button" aria-label="Close order details" onClick={closeOrderDetails}>
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <div className="order-detail-status-row">
                  <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>{deliveryStatusLabel(deliveryStatus)}</span>
                  {delayed ? <span className="status-pill delayed">Delayed</span> : <span className="status-pill sent">On Track</span>}
                </div>

                {drawerNotice ? (
                  <div className={`notice ${drawerNotice.type}`}>
                    <strong>
                      {drawerNotice.type === "success" ? "Saved" : null}
                      {drawerNotice.type === "warning" ? "Warning" : null}
                      {drawerNotice.type === "error" ? "Update failed" : null}
                    </strong>
                    <p>{drawerNotice.message}</p>
                  </div>
                ) : null}

                <section className={delayed ? "next-action-card urgent" : "next-action-card"}>
                  <div>
                    <span>Next action</span>
                    <strong>{nextAction.title}</strong>
                    <p>{nextAction.detail}</p>
                  </div>
                  {selectedRow.trackingId && deliveryStatus !== "Delivered" ? (
                    <button
                      className="button"
                      disabled={rowIsChecking}
                      type="button"
                      onClick={() => {
                        void checkSingleDeliveryStatus(selectedRow);
                      }}
                    >
                      <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={18} />
                      {rowIsChecking ? "Checking" : "Check Status"}
                    </button>
                  ) : null}
                </section>

                <section className="detail-section">
                  <h3>Courier</h3>
                  <div className="detail-grid">
                    <div>
                      <span>Courier</span>
                      <strong>{selectedRow.courierName || "-"}</strong>
                    </div>
                    <div>
                      <span>Shipment</span>
                      <strong>{courierScanLabel(selectedRow)}</strong>
                    </div>
                    <div>
                      <span>Delivery date</span>
                      <strong>{formatOrderDate(selectedRow.deliveryDate) || "-"}</strong>
                    </div>
                    <div>
                      <span>Last checked</span>
                      <strong>{trackingCheckLabel(selectedRow) || "No tracking yet"}</strong>
                      {trackingProviderLabel(selectedRow.trackingProvider) ? <small>From {trackingProviderLabel(selectedRow.trackingProvider)}</small> : null}
                    </div>
                  </div>

                  <label className="field">
                    <span>Courier charge in rupees</span>
                    <input
                      disabled={rowIsSaving}
                      inputMode="decimal"
                      min="0"
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={inlineDraft.courierCharge}
                      onBlur={() => {
                        void saveInlineFields(selectedRow);
                      }}
                      onChange={(event) => updateInlineDraft(selectedRow, "courierCharge", event.target.value)}
                    />
                  </label>
                </section>

                <section className="detail-section">
                  <h3>Tracking</h3>
                  <div className="detail-grid">
                    <div>
                      <span>Tracking ID</span>
                      <strong>{selectedRow.trackingId || "-"}</strong>
                    </div>
                  </div>
                  {selectedRow.trackingCheckError ? <p className="error-text">{selectedRow.trackingCheckError}</p> : null}
                  <div className="drawer-actions">
                    {trackingUrl ? (
                      <>
                        <button className="button secondary" type="button" onClick={() => setTrackingPreviewOrderId(selectedRow.id)}>
                          <Eye aria-hidden="true" size={18} />
                          Preview Tracking
                        </button>
                        <a className="button secondary" href={trackingUrl} rel="noreferrer" target="_blank">
                          <ExternalLink aria-hidden="true" size={18} />
                          Open Tracking Page
                        </a>
                      </>
                    ) : null}
                    {selectedRow.trackingId && deliveryStatus !== "Delivered" ? (
                      <button
                        className="button"
                        disabled={rowIsChecking}
                        type="button"
                        onClick={() => {
                          void checkSingleDeliveryStatus(selectedRow);
                        }}
                      >
                        <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={18} />
                        {rowIsChecking ? "Checking" : "Check Status"}
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="detail-section">
                  <h3>Notes</h3>
                  <label className="field">
                    <span>Courier comments</span>
                    <textarea
                      disabled={rowIsSaving}
                      placeholder="Spoke with courier, rerouted, follow-up note..."
                      value={inlineDraft.courierComment}
                      onBlur={() => {
                        void saveInlineFields(selectedRow);
                      }}
                      onChange={(event) => updateInlineDraft(selectedRow, "courierComment", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Review comments</span>
                    <textarea
                      disabled={rowIsSaving}
                      placeholder="Add review note"
                      value={inlineDraft.reviewComment}
                      onBlur={() => {
                        void saveInlineFields(selectedRow);
                      }}
                      onChange={(event) => updateInlineDraft(selectedRow, "reviewComment", event.target.value)}
                    />
                  </label>
                </section>
              </aside>
            );
          })()}
        </div>
      ) : null}

      {trackingPreviewRow ? (
        <div className="tracking-preview-layer">
          <button
            aria-label="Close tracking preview"
            className="tracking-preview-scrim"
            type="button"
            onClick={() => setTrackingPreviewOrderId(null)}
          />
          {(() => {
            const previewUrl = trackingUrlForRow(trackingPreviewRow);
            const deliveryStatus = deliveryStatusForRow(trackingPreviewRow);
            const delayed = isDelayedOrder(trackingPreviewRow, currentDate, deliveryDelayDays);
            const rowIsChecking = checkingRowIds.has(trackingPreviewRow.id);
            const livePreview = trackingPreviewData?.orderId === trackingPreviewRow.id ? trackingPreviewData.response : null;
            const liveDetails = livePreview?.details ?? null;
            const liveStatus = livePreview?.status ?? null;
            const previewDeliveryStatus = liveStatus?.deliveryStatus ?? deliveryStatus;
            const previewTrackingStatus = liveStatus?.trackingStatus ?? trackingPreviewRow.trackingStatus;
            const previewRawStatus = liveDetails?.rawStatus ?? liveStatus?.rawStatus ?? previewDeliveryStatus;
            const previewTrackingProvider = trackingProviderLabel(liveStatus?.trackingProvider ?? trackingPreviewRow.trackingProvider);
            const livePreviewUrl = liveStatus?.trackingUrl ?? previewUrl;

            return (
              <section className="tracking-preview-panel" aria-label={`Tracking preview for ${trackingPreviewRow.trackingId || "shipment"}`}>
                <div className="tracking-preview-header">
                  <div>
                    <p className="eyebrow">Tracking Preview</p>
                    <h2>{trackingPreviewRow.trackingId || "No tracking ID"}</h2>
                    <p>
                      {trackingPreviewRow.courierName || "No courier"}
                    </p>
                  </div>
                  <div className="tracking-preview-actions">
                    {livePreviewUrl ? (
                      <a className="mini-button" href={livePreviewUrl} rel="noreferrer" target="_blank">
                        <ExternalLink aria-hidden="true" size={14} />
                        Open
                      </a>
                    ) : null}
                    <button className="icon-button" type="button" aria-label="Close tracking preview" onClick={() => setTrackingPreviewOrderId(null)}>
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                </div>

                <div className="tracking-preview-content">
                  <div className="tracking-order-context">
                    <div>
                      <span>Order ID</span>
                      <strong>{trackingPreviewRow.orderId}</strong>
                    </div>
                    <div>
                      <span>Order name</span>
                      <strong>{trackingPreviewRow.name || "-"}</strong>
                    </div>
                    <div>
                      <span>Location</span>
                      <strong>{cityStateLabel(trackingPreviewRow)}</strong>
                    </div>
                  </div>

                  {trackingPreviewLoading ? (
                    <div className="tracking-preview-loading">
                      <RefreshCw aria-hidden="true" className="spin" size={18} />
                      <strong>Loading live tracking page data</strong>
                    </div>
                  ) : null}

                  <div className="tracking-live-status">
                    <div>
                      <span>Current status</span>
                      <strong className={`status-pill ${previewDeliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>
                        {previewRawStatus}
                      </strong>
                      {delayed ? <em>Delayed by configured threshold</em> : null}
                    </div>
                    <div>
                      <span>Last updated on tracking page</span>
                      <strong>{formatTrackingDateTime(liveDetails?.lastUpdatedAt ?? liveDetails?.lastEventAt)}</strong>
                    </div>
                    <div>
                      <span>Status fetched from</span>
                      <strong>{previewTrackingProvider || "Tracking page"}</strong>
                    </div>
                  </div>

                  <section className="tracking-preview-section">
                    <h3>Shipment Details</h3>
                    <div className="tracking-preview-grid">
                      <div>
                        <span>Courier</span>
                        <strong>{trackingPreviewRow.courierName || "-"}</strong>
                      </div>
                      <div>
                        <span>Tracking ID</span>
                        <strong>{trackingPreviewRow.trackingId || "-"}</strong>
                      </div>
                      <div>
                        <span>Booked on</span>
                        <strong>{formatTrackingDateTime(liveDetails?.bookedAt ?? liveStatus?.courierDate)}</strong>
                      </div>
                      <div>
                        <span>Delivered</span>
                        <strong>{formatTrackingDateTime(liveDetails?.deliveredAt ?? liveStatus?.deliveryDate)}</strong>
                      </div>
                      <div>
                        <span>Estimated delivery</span>
                        <strong>{formatTrackingDateTime(liveDetails?.estimatedDeliveryDate)}</strong>
                      </div>
                      <div>
                        <span>Scheduled delivery</span>
                        <strong>{formatTrackingDateTime(liveDetails?.scheduledDeliveryDate)}</strong>
                      </div>
                      <div>
                        <span>Origin</span>
                        <strong>{liveDetails?.origin || "-"}</strong>
                      </div>
                      <div>
                        <span>Destination</span>
                        <strong>{liveDetails?.destination || "-"}</strong>
                      </div>
                      <div>
                        <span>Reference number</span>
                        <strong>{liveDetails?.referenceNumber || "-"}</strong>
                      </div>
                      <div>
                        <span>Weight / pieces</span>
                        <strong>{[liveDetails?.weight, liveDetails?.pieces ? `${liveDetails.pieces} piece${liveDetails.pieces === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "-"}</strong>
                      </div>
                      <div>
                        <span>Tracking status</span>
                        <strong>{previewTrackingStatus || "-"}</strong>
                      </div>
                      <div>
                        <span>Delivery status</span>
                        <strong>{deliveryStatusLabel(previewDeliveryStatus)}</strong>
                      </div>
                      <div>
                        <span>Tracking page used</span>
                        <strong>{previewTrackingProvider || "-"}</strong>
                      </div>
                    </div>
                  </section>

                  {liveDetails?.events?.length ? (
                    <section className="tracking-preview-section">
                      <h3>Tracking History</h3>
                      <div className="tracking-timeline">
                        {liveDetails.events.map((event, index) => (
                          <article className="tracking-timeline-event" key={`${event.trackedAt ?? "event"}-${event.eventCode ?? index}`}>
                            <div className="tracking-timeline-dot" />
                            <div>
                              <span>{formatTrackingDateTime(event.trackedAt)}</span>
                              <strong>{event.event}</strong>
                              {event.location ? <p>{event.location}</p> : null}
                              {event.nextLocation ? <p>Next: {event.nextLocation}</p> : null}
                              {event.remarks ? <p>{event.remarks}</p> : null}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {trackingPreviewError ? (
                    <div className="tracking-preview-error">
                      <strong>Could not load tracking page details</strong>
                      <p>{trackingPreviewError}</p>
                    </div>
                  ) : null}

                  {trackingPreviewRow.trackingCheckError && !trackingPreviewError && !liveStatus ? (
                    <div className="tracking-preview-error">
                      <strong>Last check failed</strong>
                      <p>{trackingPreviewRow.trackingCheckError}</p>
                    </div>
                  ) : null}

                  <div className="tracking-preview-footer">
                    {trackingPreviewRow.trackingId && previewDeliveryStatus !== "Delivered" ? (
                      <button
                        className="button"
                        disabled={rowIsChecking || trackingPreviewLoading}
                        type="button"
                        onClick={() => {
                          void (async () => {
                            await checkSingleDeliveryStatus(trackingPreviewRow);
                            setTrackingPreviewReloadToken((value) => value + 1);
                          })();
                        }}
                      >
                        <RefreshCw aria-hidden="true" className={rowIsChecking || trackingPreviewLoading ? "spin" : ""} size={18} />
                        {rowIsChecking || trackingPreviewLoading ? "Refreshing" : "Refresh Status"}
                      </button>
                    ) : null}
                    {livePreviewUrl ? (
                      <a className="button secondary" href={livePreviewUrl} rel="noreferrer" target="_blank">
                        <ExternalLink aria-hidden="true" size={18} />
                        Open Courier Page
                      </a>
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })()}
        </div>
      ) : null}
    </>
  );
}
