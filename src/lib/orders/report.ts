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
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  sortKey?: ReportSortKey;
};

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
  const commentsResponse = await supabase
    .from("order_comments")
    .select("order_id, comment, created_at")
    .eq("comment_type", commentType)
    .in("order_id", orderIds)
    .order("created_at", { ascending: false })
    .returns<CommentRow[]>();

  if (!commentsResponse.error) {
    for (const comment of commentsResponse.data ?? []) {
      if (!commentsByOrder.has(comment.order_id)) {
        commentsByOrder.set(comment.order_id, comment.comment);
      }
    }
  }

  return commentsByOrder;
}

export async function getOrdersReportRows(input: OrdersReportPageInput = {}) {
  try {
    const supabase = createServerSupabaseClient();
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(Math.max(1, input.pageSize ?? 100), 250);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const sortKey = input.sortKey ?? "date-desc";

    let query = supabase
      .from("orders")
      .select(reportSelect, { count: "exact" });

    if (input.startDate) {
      query = query.gte("order_date", input.startDate);
    }

    if (input.endDate) {
      query = query.lte("order_date", input.endDate);
    }

    if (sortKey === "date-asc") {
      query = query.order("order_date", { ascending: true }).order("order_name", { ascending: true });
    } else if (sortKey === "order-asc") {
      query = query.order("order_name", { ascending: true });
    } else if (sortKey === "order-desc") {
      query = query.order("order_name", { ascending: false });
    } else if (sortKey === "name-asc") {
      query = query.order("customer_name", { ascending: true, nullsFirst: false }).order("order_date", { ascending: false });
    } else {
      query = query.order("order_date", { ascending: false }).order("order_name", { ascending: false });
    }

    const ordersResponse = await query.range(from, to).returns<OrderQueryRow[]>();

    if (ordersResponse.error) {
      return {
        rows: [],
        totalRows: 0,
        error: ordersResponse.error.message
      };
    }

    const orders = ordersResponse.data ?? [];
    const orderIds = orders.map((order) => order.id);
    const [reviewCommentsByOrder, courierCommentsByOrder] = await Promise.all([
      getLatestComments(orderIds, "Review"),
      getLatestComments(orderIds, "Courier Issue")
    ]);

    return {
      rows: mapReportRows(orders, reviewCommentsByOrder, courierCommentsByOrder),
      totalRows: ordersResponse.count ?? orders.length,
      error: null
    };
  } catch (error) {
    return {
      rows: [],
      totalRows: 0,
      error: error instanceof Error ? error.message : "Could not load order report."
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
