import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

type OrderTrackingJoin = {
  courier_date: string | null;
  courier_name: string | null;
  courier_charge: number | null;
  tracking_id: string | null;
  tracking_url: string | null;
  tracking_status: string | null;
  tracking_checked_at: string | null;
  tracking_check_error: string | null;
  tracking_check_source: string | null;
  tracking_provider: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
};

type OrderCommunicationJoin = {
  confirm_txt_status: string | null;
  tracking_txt_status: string | null;
  review_txt_status: string | null;
};

type OrderQueryRow = {
  id: string;
  order_date: string;
  order_name: string;
  shipping_city: string | null;
  shipping_state: string | null;
  total_price: number;
  customer_name: string | null;
  order_tracking: OrderTrackingJoin | OrderTrackingJoin[] | null;
  order_communication: OrderCommunicationJoin | OrderCommunicationJoin[] | null;
};

type CommentRow = {
  order_id: string;
  comment: string;
  created_at: string;
};

export type ReportRow = {
  id: string;
  date: string;
  orderId: string;
  price: number;
  name: string;
  city: string;
  state: string;
  confirmText: string;
  courierDate: string;
  courierName: string;
  courierCharge: number | null;
  trackingId: string;
  trackingUrl: string;
  trackingStatus: string;
  trackingCheckedAt: string;
  trackingCheckError: string;
  trackingCheckSource: string;
  trackingProvider: string;
  trackingText: string;
  deliveryDate: string;
  deliveryStatus: string;
  reviewText: string;
  reviewComments: string;
  courierComments: string;
};

export type ReportSortKey =
  | "date-desc"
  | "date-asc"
  | "order-desc"
  | "order-asc"
  | "name-asc"
  | "courier-asc"
  | "delivery-asc";

export type OrdersReportPageInput = {
  courierName?: string;
  currentDate?: string;
  deliveryDelayDays?: number;
  deliveryStatus?: string;
  delayStatus?: string;
  page?: number;
  pageSize?: number;
  focusStatus?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortKey?: ReportSortKey;
};

export type OrdersReportSummary = {
  checkFailed: number;
  delayed: number;
  delivered: number;
  inTransit: number;
  notShipped: number;
  reviewPending: number;
  total: number;
};

export type DuplicateTrackingEntry = {
  orderIds: string[];
  trackingId: string;
};

export type OrdersReportSummaryInput = {
  currentDate: string;
  deliveryDelayDays: number;
  startDate?: string;
  endDate?: string;
};

const emptyReportSummary: OrdersReportSummary = {
  checkFailed: 0,
  delayed: 0,
  delivered: 0,
  inTransit: 0,
  notShipped: 0,
  reviewPending: 0,
  total: 0
};

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function firstJoin<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function mapReportRows(
  orders: OrderQueryRow[],
  reviewCommentsByOrder: Map<string, string>,
  courierCommentsByOrder: Map<string, string>
) {
  return orders.map<ReportRow>((order) => {
    const tracking = firstJoin(order.order_tracking);
    const communication = firstJoin(order.order_communication);

    return {
      id: order.id,
      date: order.order_date,
      orderId: order.order_name,
      price: order.total_price,
      name: order.customer_name ?? "",
      city: order.shipping_city ?? "",
      state: order.shipping_state ?? "",
      confirmText: communication?.confirm_txt_status ?? "Pending",
      courierDate: tracking?.courier_date ?? "",
      courierName: tracking?.courier_name ?? "",
      courierCharge: tracking?.courier_charge ?? null,
      trackingId: tracking?.tracking_id ?? "",
      trackingUrl: tracking?.tracking_url ?? "",
      trackingStatus: tracking?.tracking_status ?? "Pending",
      trackingCheckedAt: tracking?.tracking_checked_at ?? "",
      trackingCheckError: tracking?.tracking_check_error ?? "",
      trackingCheckSource: tracking?.tracking_check_source ?? "",
      trackingProvider: tracking?.tracking_provider ?? "",
      trackingText: communication?.tracking_txt_status ?? "Pending",
      deliveryDate: tracking?.delivery_date ?? "",
      deliveryStatus: tracking?.delivery_status ?? "Pending",
      reviewText: communication?.review_txt_status ?? "Pending",
      reviewComments: reviewCommentsByOrder.get(order.id) ?? "",
      courierComments: courierCommentsByOrder.get(order.id) ?? ""
    };
  });
}

const reportSelect = `
  id,
  order_date,
  order_name,
  shipping_city,
  shipping_state,
  total_price,
  customer_name,
  order_tracking (
    courier_date,
    courier_name,
    courier_charge,
    tracking_id,
    tracking_url,
    tracking_status,
    tracking_checked_at,
    tracking_check_error,
    tracking_check_source,
    tracking_provider,
    delivery_date,
    delivery_status
  ),
  order_communication (
    confirm_txt_status,
    tracking_txt_status,
    review_txt_status
  )
`;

async function getLatestComments(orderIds: string[], commentType: "Review" | "Courier Issue") {
  const commentsByOrder = new Map<string, string>();

  if (!orderIds.length) {
    return commentsByOrder;
  }

  const supabase = createServerSupabaseClient();

  for (const orderIdChunk of chunkValues(orderIds, 200)) {
    const commentsResponse = await supabase
      .from("order_comments")
      .select("order_id, comment, created_at")
      .eq("comment_type", commentType)
      .in("order_id", orderIdChunk)
      .order("created_at", { ascending: false })
      .returns<CommentRow[]>();

    if (!commentsResponse.error) {
      for (const comment of commentsResponse.data ?? []) {
        if (!commentsByOrder.has(comment.order_id)) {
          commentsByOrder.set(comment.order_id, comment.comment);
        }
      }
    }
  }

  return commentsByOrder;
}

function isMessageSent(status: string) {
  return status === "Sent" || status === "Received";
}

function deliveryStatusForReportRow(row: ReportRow) {
  if (row.trackingId.trim() && row.trackingCheckError && row.deliveryStatus !== "Delivered" && row.deliveryStatus !== "Returned") {
    return "Check Failed";
  }

  if (!row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Not Shipped";
  }

  if (row.trackingId.trim() && row.deliveryStatus === "Pending") {
    return "Tracking Added";
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

function isDelayedReportRow(row: ReportRow, currentDate: string, deliveryDelayDays: number) {
  return Boolean(
    row.courierDate &&
      deliveryStatusForReportRow(row) !== "Delivered" &&
      deliveryStatusForReportRow(row) !== "Check Failed" &&
      daysBetweenDates(row.courierDate, currentDate) >= deliveryDelayDays
  );
}

function orderNumber(orderId: string) {
  const numeric = Number(orderId.replace(/\D/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function courierFilterValueForReportRow(row: ReportRow) {
  return row.courierName === "Other" ? "ST Courier" : row.courierName;
}

function sortReportRows(rows: ReportRow[], sortKey: ReportSortKey) {
  return [...rows].sort((left, right) => {
    if (sortKey === "date-desc") return compareText(right.date, left.date) || orderNumber(right.orderId) - orderNumber(left.orderId);
    if (sortKey === "date-asc") return compareText(left.date, right.date) || orderNumber(left.orderId) - orderNumber(right.orderId);
    if (sortKey === "order-desc") return orderNumber(right.orderId) - orderNumber(left.orderId);
    if (sortKey === "order-asc") return orderNumber(left.orderId) - orderNumber(right.orderId);
    if (sortKey === "name-asc") return compareText(left.name, right.name);
    if (sortKey === "courier-asc") return compareText(left.courierName, right.courierName);
    return compareText(deliveryStatusForReportRow(left), deliveryStatusForReportRow(right));
  });
}

function filterReportRows(rows: ReportRow[], input: OrdersReportPageInput) {
  const search = input.search?.trim().toLowerCase() ?? "";
  const currentDate = input.currentDate ?? new Date().toISOString().slice(0, 10);
  const deliveryDelayDays = input.deliveryDelayDays ?? 4;

  return rows.filter((row) => {
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
        row.state,
        row.courierComments,
        row.trackingId,
        row.trackingCheckedAt,
        row.trackingCheckError,
        row.trackingText,
        row.deliveryDate,
        deliveryStatusForReportRow(row),
        row.reviewText,
        row.reviewComments
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    const courierMatches = !input.courierName || courierFilterValueForReportRow(row) === input.courierName;
    const deliveryStatus = deliveryStatusForReportRow(row);
    const deliveryMatches = !input.deliveryStatus || deliveryStatus === input.deliveryStatus;
    const delayed = isDelayedReportRow(row, currentDate, deliveryDelayDays);
    const delayMatches =
      !input.delayStatus ||
      (input.delayStatus === "delayed" && delayed) ||
      (input.delayStatus === "not-delayed" && !delayed);
    const focusMatches =
      !input.focusStatus ||
      (input.focusStatus === "review-pending" && !isMessageSent(row.reviewText)) ||
      (input.focusStatus === "moving" && (deliveryStatus === "In Transit" || deliveryStatus === "Tracking Added"));

    return searchMatches && courierMatches && deliveryMatches && delayMatches && focusMatches;
  });
}

function summarizeReportRows(rows: ReportRow[], input: OrdersReportSummaryInput): OrdersReportSummary {
  return rows.reduce<OrdersReportSummary>(
    (summary, row) => {
      const deliveryStatus = deliveryStatusForReportRow(row);

      summary.total += 1;

      if (isDelayedReportRow(row, input.currentDate, input.deliveryDelayDays)) {
        summary.delayed += 1;
      }

      if (deliveryStatus === "Not Shipped") {
        summary.notShipped += 1;
      }

      if (deliveryStatus === "Check Failed") {
        summary.checkFailed += 1;
      }

      if (deliveryStatus === "In Transit" || deliveryStatus === "Tracking Added") {
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
    { ...emptyReportSummary }
  );
}

function findDuplicateTrackingEntries(rows: ReportRow[]): DuplicateTrackingEntry[] {
  const orderIdsByTrackingId = new Map<string, string[]>();

  for (const row of rows) {
    const trackingId = row.trackingId.trim();

    if (!trackingId) {
      continue;
    }

    orderIdsByTrackingId.set(trackingId, [...(orderIdsByTrackingId.get(trackingId) ?? []), row.orderId]);
  }

  return [...orderIdsByTrackingId.entries()]
    .filter(([, orderIds]) => orderIds.length > 1)
    .map(([trackingId, orderIds]) => ({ orderIds, trackingId }));
}

async function getOrderRowsInDateRange(input: Pick<OrdersReportPageInput, "startDate" | "endDate">) {
  const supabase = createServerSupabaseClient();
  const pageSize = 1000;
  const orders: OrderQueryRow[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("orders")
      .select(reportSelect)
      .order("order_date", { ascending: false })
      .order("order_name", { ascending: false });

    if (input.startDate) {
      query = query.gte("order_date", input.startDate);
    }

    if (input.endDate) {
      query = query.lte("order_date", input.endDate);
    }

    const ordersResponse = await query.range(from, from + pageSize - 1).returns<OrderQueryRow[]>();

    if (ordersResponse.error) {
      throw new Error(ordersResponse.error.message);
    }

    const page = ordersResponse.data ?? [];
    orders.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return orders;
}

export async function getOrdersReportRows(input: OrdersReportPageInput = {}) {
  try {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(Math.max(1, input.pageSize ?? 100), 250);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const sortKey = input.sortKey ?? "date-desc";
    const orders = await getOrderRowsInDateRange(input);
    const orderIds = orders.map((order) => order.id);
    const [reviewCommentsByOrder, courierCommentsByOrder] = await Promise.all([
      getLatestComments(orderIds, "Review"),
      getLatestComments(orderIds, "Courier Issue")
    ]);
    const mappedRows = mapReportRows(orders, reviewCommentsByOrder, courierCommentsByOrder);
    const filteredRows = filterReportRows(mappedRows, input);
    const sortedRows = sortReportRows(filteredRows, sortKey);

    return {
      duplicateTrackingEntries: findDuplicateTrackingEntries(sortedRows),
      rows: sortedRows.slice(from, to + 1),
      totalRows: sortedRows.length,
      error: null
    };
  } catch (error) {
    return {
      duplicateTrackingEntries: [],
      rows: [],
      totalRows: 0,
      error: error instanceof Error ? error.message : "Could not load order report."
    };
  }
}

export async function getOrdersReportSummary(input: OrdersReportSummaryInput) {
  try {
    const orders = await getOrderRowsInDateRange(input);
    return {
      error: null,
      summary: summarizeReportRows(mapReportRows(orders, new Map(), new Map()), input)
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not load order summary.",
      summary: { ...emptyReportSummary }
    };
  }
}

export async function getOrderReportRow(orderId: string) {
  const supabase = createServerSupabaseClient();
  const ordersResponse = await supabase
    .from("orders")
    .select(reportSelect)
    .eq("id", orderId)
    .limit(1)
    .returns<OrderQueryRow[]>();

  if (ordersResponse.error) {
    throw new Error(ordersResponse.error.message);
  }

  const order = ordersResponse.data?.[0];

  if (!order) {
    throw new Error("Order was not found.");
  }

  const [reviewCommentsByOrder, courierCommentsByOrder] = await Promise.all([
    getLatestComments([order.id], "Review"),
    getLatestComments([order.id], "Courier Issue")
  ]);
  return mapReportRows([order], reviewCommentsByOrder, courierCommentsByOrder)[0];
}
