"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Filter, Info, RefreshCw, Search, X } from "lucide-react";

import type { ReportRow } from "@/lib/orders/report";
import { resolveTrackingUrl, supportedCourierOptions } from "@/lib/courier/tracking-links";
import { reportColumns } from "@/lib/report/columns";
import { statusOptions } from "@/lib/status-options";

type OrdersReportProps = {
  currentDate: string;
  deliveryDelayDays: number;
  initialEndDate: string;
  initialRows: ReportRow[];
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

type DateRangePreset = "today" | "last-7" | "this-month" | "custom";

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
  rows?: ReportRow[];
  totalRows?: number;
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
  { label: "This month", value: "this-month" },
  { label: "Custom", value: "custom" }
];

function isMessageSent(status: string) {
  return status === "Sent" || status === "Received";
}

function messageStatusFromChecked(checked: boolean) {
  return checked ? "Sent" : "Pending";
}

function messageExportValue(status: string) {
  return isMessageSent(status) ? "Yes" : "No";
}

function deliveryStatusForRow(row: ReportRow) {
  if (!row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Not Shipped";
  }

  if (row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Shipped";
  }

  return row.deliveryStatus;
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

function txtStatusSummary(confirmText: string, trackingText: string, reviewText: string) {
  const sentCount = [confirmText, trackingText, reviewText].filter(isMessageSent).length;
  return `${sentCount}/3 sent`;
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
    CITY: row.city,
    "COURIER DATE": row.courierDate,
    "COURIER NAME": row.courierName,
    "COURIER CHARGE": row.courierCharge,
    "TRACKING ID": row.trackingId,
    "TXT STATUS": `Confirm: ${messageExportValue(row.confirmText)} / Tracking: ${messageExportValue(row.trackingText)} / Review: ${messageExportValue(row.reviewText)}`,
    "DELIVERY DATE": row.deliveryDate,
    "DELIVERY STATUS": deliveryStatusForRow(row),
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

  return {
    endDate: currentDate,
    startDate: addDaysToDateInput(currentDate, -6)
  };
}

function orderNumber(orderId: string) {
  const numeric = Number(orderId.replace(/\D/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function trackingUrlForRow(row: ReportRow) {
  return resolveTrackingUrl(row.courierName, row.trackingId, row.trackingUrl);
}

function courierFilterValueForRow(row: ReportRow) {
  return row.courierName === "Other" ? "ST Courier" : row.courierName;
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

function stickyClassForColumn(column: string) {
  if (column === "DATE") return "sticky-col sticky-col-1";
  if (column === "ORDER ID") return "sticky-col sticky-col-2";
  if (column === "NAME") return "sticky-col sticky-col-3";
  return "";
}

function sortRows(rows: ReportRow[], sortKey: SortKey, currentDate: string, deliveryDelayDays: number) {
  return [...rows].sort((left, right) => {
    const delayedSort =
      Number(isDelayedOrder(right, currentDate, deliveryDelayDays)) -
      Number(isDelayedOrder(left, currentDate, deliveryDelayDays));

    if (delayedSort) return delayedSort;
    if (sortKey === "date-desc") return compareText(right.date, left.date) || orderNumber(right.orderId) - orderNumber(left.orderId);
    if (sortKey === "date-asc") return compareText(left.date, right.date) || orderNumber(left.orderId) - orderNumber(right.orderId);
    if (sortKey === "order-desc") return orderNumber(right.orderId) - orderNumber(left.orderId);
    if (sortKey === "order-asc") return orderNumber(left.orderId) - orderNumber(right.orderId);
    if (sortKey === "name-asc") return compareText(left.name, right.name);
    if (sortKey === "courier-asc") return compareText(left.courierName, right.courierName);
    return compareText(deliveryStatusForRow(left), deliveryStatusForRow(right));
  });
}

export function OrdersReport({
  currentDate,
  deliveryDelayDays,
  initialEndDate,
  initialRows,
  initialStartDate,
  initialTotalRows
}: OrdersReportProps) {
  const [rows, setRows] = useState(initialRows);
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
  const [loadingPage, setLoadingPage] = useState(false);
  const [inlineDrafts, setInlineDrafts] = useState<Record<string, InlineMessageDraft>>({});
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set());
  const [checkingStatuses, setCheckingStatuses] = useState(false);
  const [checkingRowIds, setCheckingRowIds] = useState<Set<string>>(() => new Set());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  const didLoadInitialPage = useRef(false);
  useEffect(() => {
    if (!didLoadInitialPage.current) {
      didLoadInitialPage.current = true;
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortKey
    });

    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);

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
        setTotalRows(data.totalRows ?? data.rows.length);
        setSelectedOrderId((current) => (current && data.rows?.some((row) => row.id === current) ? current : null));
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
  }, [filters.endDate, filters.startDate, page, pageSize, sortKey]);
  const duplicateTrackingIds = useMemo(() => {
    const counts = new Map<string, string[]>();

    for (const row of rows) {
      const trackingId = row.trackingId.trim();

      if (!trackingId) {
        continue;
      }

      counts.set(trackingId, [...(counts.get(trackingId) ?? []), row.orderId]);
    }

    return new Map([...counts.entries()].filter(([, orderIds]) => orderIds.length > 1));
  }, [rows]);
  const duplicateTrackingEntries = useMemo(
    () => [...duplicateTrackingIds.entries()].map(([trackingId, orderIds]) => ({ orderIds, trackingId })),
    [duplicateTrackingIds]
  );
  const dateFilteredRows = useMemo(() => {
    return rows.filter((row) => {
      const startMatches = !filters.startDate || row.date >= filters.startDate;
      const endMatches = !filters.endDate || row.date <= filters.endDate;
      return startMatches && endMatches;
    });
  }, [filters.endDate, filters.startDate, rows]);
  const operationsSummary = useMemo(() => {
    return dateFilteredRows.reduce(
      (summary, row) => {
        const deliveryStatus = deliveryStatusForRow(row);

        summary.total += 1;

        if (isDelayedOrder(row, currentDate, deliveryDelayDays)) {
          summary.delayed += 1;
        }

        if (deliveryStatus === "Not Shipped") {
          summary.notShipped += 1;
        }

        if (deliveryStatus === "In Transit" || deliveryStatus === "Shipped") {
          summary.inTransit += 1;
        }

        if (deliveryStatus === "Delivered") {
          summary.delivered += 1;
        }

        if (!isMessageSent(row.reviewText)) {
          summary.reviewPending += 1;
        }

        return summary;
      },
      {
        delayed: 0,
        delivered: 0,
        inTransit: 0,
        notShipped: 0,
        reviewPending: 0,
        total: 0
      }
    );
  }, [currentDate, dateFilteredRows, deliveryDelayDays]);

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return dateFilteredRows.filter((row) => {
      const searchMatches =
        !search ||
        [
          row.date,
          row.orderId,
          row.name,
          row.confirmText,
          row.courierDate,
          row.courierName,
          row.city,
          row.courierComments,
          row.trackingId,
          row.trackingCheckedAt,
          row.trackingCheckError,
          row.trackingText,
          row.deliveryDate,
          deliveryStatusForRow(row),
          row.reviewText,
          row.reviewComments
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      const courierMatches = !filters.courierName || courierFilterValueForRow(row) === filters.courierName;
      const deliveryStatus = deliveryStatusForRow(row);
      const deliveryMatches = !filters.deliveryStatus || deliveryStatus === filters.deliveryStatus;
      const delayed = isDelayedOrder(row, currentDate, deliveryDelayDays);
      const delayMatches =
        !filters.delayStatus ||
        (filters.delayStatus === "delayed" && delayed) ||
        (filters.delayStatus === "not-delayed" && !delayed);
      const focusMatches =
        !filters.focusStatus ||
        (filters.focusStatus === "review-pending" && !isMessageSent(row.reviewText)) ||
        (filters.focusStatus === "moving" && (deliveryStatus === "In Transit" || deliveryStatus === "Shipped"));

      return (
        searchMatches &&
        courierMatches &&
        deliveryMatches &&
        delayMatches &&
        focusMatches
      );
    });
  }, [currentDate, dateFilteredRows, deliveryDelayDays, filters]);

  const sortedRows = useMemo(
    () => sortRows(filteredRows, sortKey, currentDate, deliveryDelayDays),
    [currentDate, deliveryDelayDays, filteredRows, sortKey]
  );
  const statusCheckRows = useMemo(() => rows.filter((row) => row.trackingId.trim() && row.deliveryStatus !== "Delivered"), [rows]);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sortedRows;
  const selectedRow = useMemo(
    () => (selectedOrderId ? rows.find((row) => row.id === selectedOrderId) ?? null : null),
    [rows, selectedOrderId]
  );
  const activeFilterChips = useMemo(() => {
    const chips: string[] = [];

    if (filters.search.trim()) chips.push(`Search: ${filters.search.trim()}`);
    if (filters.startDate || filters.endDate) chips.push(`Date: ${filters.startDate || "Start"} to ${filters.endDate || "Today"}`);
    if (filters.courierName) chips.push(`Courier: ${filters.courierName}`);
    if (filters.deliveryStatus) chips.push(`Delivery: ${filters.deliveryStatus}`);
    if (filters.delayStatus === "delayed") chips.push("Delayed only");
    if (filters.delayStatus === "not-delayed") chips.push("Not delayed");
    if (filters.focusStatus === "moving") chips.push("Moving orders");
    if (filters.focusStatus === "review-pending") chips.push("Review pending");

    return chips;
  }, [filters]);

  function updateFilter(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function updateCustomDate(key: "startDate" | "endDate", value: string) {
    setDateRangePreset("custom");
    updateFilter(key, value);
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
    setFilters((current) => ({
      ...emptyFilters,
      endDate: current.endDate,
      startDate: current.startDate
    }));
    setSortKey("date-desc");
    setPage(1);
  }

  function showDelayedOrders() {
    setFilters((current) => ({ ...current, delayStatus: "delayed", deliveryStatus: "", focusStatus: "" }));
    setPage(1);
  }

  function showDeliveryStatus(deliveryStatus: string) {
    setFilters((current) => ({ ...current, delayStatus: "", deliveryStatus, focusStatus: "" }));
    setPage(1);
  }

  function showReviewPending() {
    setFilters((current) => ({ ...current, delayStatus: "", deliveryStatus: "", focusStatus: "review-pending" }));
    setPage(1);
  }

  function showMovingOrders() {
    setFilters((current) => ({ ...current, delayStatus: "", deliveryStatus: "", focusStatus: "moving" }));
    setPage(1);
  }

  function setDateRange(range: DateRangePreset) {
    setDateRangePreset(range);

    if (range !== "custom") {
      setFilters((current) => ({
        ...current,
        ...getDateRangeForPreset(range, currentDate)
      }));
    }

    setPage(1);
  }

  function exportFilteredRows() {
    if (!sortedRows.length) {
      setNotice({ type: "error", message: "There are no visible rows to export." });
      return;
    }

    const csv = [
      reportColumns.map(csvEscape).join(","),
      ...sortedRows.map((row) =>
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
    setNotice({ type: "success", message: `Exported ${sortedRows.length} filtered rows.` });
  }

  async function saveOrderDraft(row: ReportRow, nextDraft: Draft, successMessage: string) {
    setRowSaving(row.id, true);
    setNotice(null);

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
      setNotice({
        type: data.warning ? "warning" : "success",
        message: data.warning ?? successMessage
      });
    } catch (error) {
      setNotice({
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
    setNotice(null);

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
      setNotice({
        type: data.failed ? "warning" : "success",
        message: `Checked ${targetText}. Checked ${data.checked ?? 0}. Updated ${data.updated ?? 0}.${failedText}${skippedText}${failureDetails}`
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Could not check delivery statuses."
      });
      throw error;
    }
  }

  async function checkDeliveryStatuses() {
    setCheckingStatuses(true);

    try {
      await checkDeliveryStatusesForRows(statusCheckRows, { bulk: true });
    } catch {
      // The shared checker already shows the specific error notice.
    } finally {
      setCheckingStatuses(false);
    }
  }

  async function checkSingleDeliveryStatus(row: ReportRow) {
    if (!row.trackingId.trim()) {
      setNotice({ type: "error", message: `${row.orderId} does not have a tracking ID.` });
      return;
    }

    if (row.deliveryStatus === "Delivered" && row.courierDate) {
      setNotice({ type: "success", message: `${row.orderId} is already marked delivered.` });
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
          <div className="filter-console-count">
            <strong>{totalRows}</strong>
            <span>orders in range</span>
          </div>
        </div>
      </section>

      <section className="ops-summary" aria-label="Operational priorities">
        <button className="ops-card" type="button" onClick={clearFilters}>
          <span>Total Orders</span>
          <strong>{totalRows}</strong>
          <small>Selected range · clear filters</small>
        </button>
        <button className={`ops-card urgent ${filters.delayStatus === "delayed" ? "active" : ""}`} type="button" onClick={showDelayedOrders}>
          <span>Delayed</span>
          <strong>{operationsSummary.delayed}</strong>
          <small>{deliveryDelayDays}+ days after courier date</small>
        </button>
        <button
          className={`ops-card ${filters.deliveryStatus === "Not Shipped" ? "active" : ""}`}
          type="button"
          onClick={() => showDeliveryStatus("Not Shipped")}
        >
          <span>Not Shipped</span>
          <strong>{operationsSummary.notShipped}</strong>
          <small>Needs fulfillment/tracking</small>
        </button>
        <button
          className={`ops-card ${filters.focusStatus === "moving" ? "active" : ""}`}
          type="button"
          onClick={showMovingOrders}
        >
          <span>In Transit</span>
          <strong>{operationsSummary.inTransit}</strong>
          <small>Shipped or moving</small>
        </button>
        <button
          className={`ops-card ${filters.deliveryStatus === "Delivered" ? "active" : ""}`}
          type="button"
          onClick={() => showDeliveryStatus("Delivered")}
        >
          <span>Delivered</span>
          <strong>{operationsSummary.delivered}</strong>
          <small>Completed shipments</small>
        </button>
        <button
          className={`ops-card ${filters.focusStatus === "review-pending" ? "active" : ""}`}
          type="button"
          onClick={showReviewPending}
        >
          <span>Review Pending</span>
          <strong>{operationsSummary.reviewPending}</strong>
          <small>Needs review TXT</small>
        </button>
      </section>

      <div className="toolbar" aria-label="Report actions">
        <div className="search-field">
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="Search by order, customer, or tracking ID"
            placeholder="Search order, name, tracking"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
        </div>
        <button className="button secondary" type="button" onClick={clearFilters}>
          <X aria-hidden="true" size={18} />
          Clear
        </button>
        <button
          className="button secondary"
          disabled={checkingStatuses}
          aria-busy={checkingStatuses}
          type="button"
          onClick={checkDeliveryStatuses}
        >
          <RefreshCw aria-hidden="true" className={checkingStatuses ? "spin" : ""} size={18} />
          {checkingStatuses ? "Checking..." : "Sync courier status"}
        </button>
        <button className="button" type="button" onClick={exportFilteredRows}>
          <Download aria-hidden="true" size={18} />
          Export
        </button>
      </div>

      {checkingStatuses ? (
        <div className="running-state">
          <RefreshCw aria-hidden="true" className="spin" size={18} />
          <div>
            <strong>Courier status sync is running</strong>
            <p>Checking all pending orders one by one. Keep this page open while rows update.</p>
          </div>
        </div>
      ) : null}

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
          <p>{duplicateTrackingEntries.length} tracking ID{duplicateTrackingEntries.length === 1 ? "" : "s"} appear on multiple orders in this loaded page.</p>
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
            <p className="eyebrow">Filter Console</p>
            <h2>Refine the report table</h2>
          </div>
          <div className="filter-console-count">
            <strong>{sortedRows.length}</strong>
            <span>visible on this page</span>
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
            <span>Rows</span>
            <select value={pageSize} onChange={(event) => {
              setPageSize(Number(event.target.value) as typeof pageSize);
              setPage(1);
            }}>
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Courier</span>
            <select value={filters.courierName} onChange={(event) => updateFilter("courierName", event.target.value)}>
              <option value="">Any courier</option>
              {supportedCourierOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Delivery Status</span>
            <select value={filters.deliveryStatus} onChange={(event) => updateFilter("deliveryStatus", event.target.value)}>
              <option value="">Any</option>
              {statusOptions.delivery.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>Delay</span>
            <select value={filters.delayStatus} onChange={(event) => updateFilter("delayStatus", event.target.value)}>
              <option value="">Any</option>
              <option value="delayed">Delayed</option>
              <option value="not-delayed">Not delayed</option>
            </select>
          </label>
        </div>

        <div className="active-filter-row" aria-label="Active filters">
          {activeFilterChips.length ? (
            activeFilterChips.map((chip) => <span className="active-filter-chip" key={chip}>{chip}</span>)
          ) : (
            <span className="active-filter-empty">No filters active</span>
          )}
        </div>
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
          <span className="badge ready">{sortedRows.length} shown · {totalRows} total</span>
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

                  return (
                    <tr key={row.id}>
                      <td className="sticky-col sticky-col-1">{row.date}</td>
                      <td className="sticky-col sticky-col-2">{row.orderId}</td>
                      <td className="sticky-col sticky-col-3">{row.name || "-"}</td>
                      <td>{row.city || "-"}</td>
                      <td>
                        <div className="stacked-cell">
                          <strong>{row.courierName || "No courier"}</strong>
                          <span>{row.courierDate || "No courier date"}</span>
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
                          <span>
                            {row.trackingCheckedAt
                              ? `${formatDateTime(row.trackingCheckedAt)} · ${row.trackingCheckSource || "Manual"}`
                              : "Never checked"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>
                          {deliveryStatus}
                        </span>
                      </td>
                      <td>
                        {delayed ? (
                          <span className="status-pill delayed">Delayed</span>
                        ) : (
                          <span className="muted-text">No</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {row.trackingId && deliveryStatus !== "Delivered" ? (
                            <button
                              aria-label={`Check delivery status for ${row.orderId}`}
                              className="mini-button"
                              disabled={rowIsChecking || checkingStatuses}
                              type="button"
                              onClick={() => {
                                void checkSingleDeliveryStatus(row);
                              }}
                            >
                              <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={13} />
                              {rowIsChecking ? "Checking" : "Check"}
                            </button>
                          ) : null}
                          <button className="mini-button primary" type="button" onClick={() => setSelectedOrderId(row.id)}>
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
                        Clear filters
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

              return (
                <article className="mobile-order-card" key={row.id}>
                  <div className="mobile-order-card-header">
                    <div>
                      <span>{row.date}</span>
                      <strong>{row.orderId}</strong>
                      <small>{row.name || "No customer name"} · {row.city || "No city"}</small>
                    </div>
                    <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>
                      {deliveryStatus}
                    </span>
                  </div>
                  <div className="mobile-order-card-grid">
                    <div>
                      <span>Courier</span>
                      <strong>{row.courierName || "No courier"}</strong>
                    </div>
                    <div>
                      <span>Courier date</span>
                      <strong>{row.courierDate || "-"}</strong>
                    </div>
                    <div>
                      <span>Tracking</span>
                      <strong>{row.trackingId || "-"}</strong>
                    </div>
                    <div>
                      <span>Last checked</span>
                      <strong>
                        {row.trackingCheckedAt
                          ? `${formatDateTime(row.trackingCheckedAt)} · ${row.trackingCheckSource || "Manual"}`
                          : "Never checked"}
                      </strong>
                    </div>
                  </div>
                  {delayed ? <span className="status-pill delayed">Delayed</span> : null}
                  <div className="row-actions">
                    {trackingUrl ? (
                      <a className="mini-button" href={trackingUrl} rel="noreferrer" target="_blank">
                        Open Tracking
                      </a>
                    ) : null}
                    {row.trackingId && deliveryStatus !== "Delivered" ? (
                      <button
                        aria-label={`Check delivery status for ${row.orderId}`}
                        className="mini-button"
                        disabled={rowIsChecking || checkingStatuses}
                        type="button"
                        onClick={() => {
                          void checkSingleDeliveryStatus(row);
                        }}
                      >
                        <RefreshCw aria-hidden="true" className={rowIsChecking ? "spin" : ""} size={13} />
                        {rowIsChecking ? "Checking" : "Check"}
                      </button>
                    ) : null}
                    <button className="mini-button primary" type="button" onClick={() => setSelectedOrderId(row.id)}>
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
                Clear filters
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="filter-summary">
        <Filter aria-hidden="true" size={16} />
        <span>
          Showing {pageRows.length} visible row{pageRows.length === 1 ? "" : "s"} on page {safePage}. {totalRows} orders in range.
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
            onClick={() => setSelectedOrderId(null)}
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
                    <p>{selectedRow.name || "No customer name"} · {selectedRow.city || "No city"}</p>
                  </div>
                  <button className="icon-button" type="button" aria-label="Close order details" onClick={() => setSelectedOrderId(null)}>
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>

                <div className="order-detail-status-row">
                  <span className={`status-pill ${deliveryStatus.toLowerCase().replaceAll(" ", "-")}`}>{deliveryStatus}</span>
                  {delayed ? <span className="status-pill delayed">Delayed</span> : <span className="status-pill sent">On Track</span>}
                  <span className="txt-status-button">
                    {txtStatusSummary(inlineDraft.confirmText, inlineDraft.trackingText, inlineDraft.reviewText)}
                  </span>
                </div>

                <section className={delayed ? "next-action-card urgent" : "next-action-card"}>
                  <div>
                    <span>Next action</span>
                    <strong>{nextAction.title}</strong>
                    <p>{nextAction.detail}</p>
                  </div>
                  {selectedRow.trackingId && deliveryStatus !== "Delivered" ? (
                    <button
                      className="button"
                      disabled={rowIsChecking || checkingStatuses}
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
                      <span>Courier date</span>
                      <strong>{selectedRow.courierDate || "-"}</strong>
                    </div>
                    <div>
                      <span>Delivery date</span>
                      <strong>{selectedRow.deliveryDate || "-"}</strong>
                    </div>
                    <div>
                      <span>Last checked</span>
                      <strong>{formatDateTime(selectedRow.trackingCheckedAt)}</strong>
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
                    <div>
                      <span>Check type</span>
                      <strong>{selectedRow.trackingCheckSource || "-"}</strong>
                    </div>
                  </div>
                  {selectedRow.trackingCheckError ? <p className="error-text">{selectedRow.trackingCheckError}</p> : null}
                  <div className="drawer-actions">
                    {trackingUrl ? (
                      <a className="button secondary" href={trackingUrl} rel="noreferrer" target="_blank">
                        Open Tracking Page
                      </a>
                    ) : null}
                    {selectedRow.trackingId && deliveryStatus !== "Delivered" ? (
                      <button
                        className="button"
                        disabled={rowIsChecking || checkingStatuses}
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
                  <h3>TXT Status</h3>
                  <div className="message-check-grid">
                    <label className="cell-checkbox">
                      <input
                        checked={isMessageSent(inlineDraft.confirmText)}
                        disabled={rowIsSaving}
                        type="checkbox"
                        onChange={(event) => {
                          const confirmText = messageStatusFromChecked(event.target.checked);
                          updateInlineDraft(selectedRow, "confirmText", confirmText);
                          void saveInlineFields(selectedRow, { confirmText });
                        }}
                      />
                      <span>Confirm TXT</span>
                    </label>
                    <label className="cell-checkbox">
                      <input
                        checked={isMessageSent(inlineDraft.trackingText)}
                        disabled={rowIsSaving}
                        type="checkbox"
                        onChange={(event) => {
                          const trackingText = messageStatusFromChecked(event.target.checked);
                          updateInlineDraft(selectedRow, "trackingText", trackingText);
                          void saveInlineFields(selectedRow, { trackingText });
                        }}
                      />
                      <span>Tracking TXT</span>
                    </label>
                    <label className="cell-checkbox">
                      <input
                        checked={isMessageSent(inlineDraft.reviewText)}
                        disabled={rowIsSaving}
                        type="checkbox"
                        onChange={(event) => {
                          const reviewText = messageStatusFromChecked(event.target.checked);
                          updateInlineDraft(selectedRow, "reviewText", reviewText);
                          void saveInlineFields(selectedRow, { reviewText });
                        }}
                      />
                      <span>Review TXT</span>
                    </label>
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
    </>
  );
}
