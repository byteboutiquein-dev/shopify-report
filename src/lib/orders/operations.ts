import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveTrackingUrl } from "@/lib/courier/tracking-links";
import { getOrderReportRow, type ReportRow } from "@/lib/orders/report";

export type OrderOperationInput = {
  courierDate: string | null;
  courierName: string | null;
  courierCharge: number | null;
  trackingId: string | null;
  trackingUrl: string | null;
  trackingStatus: string;
  deliveryDate: string | null;
  deliveryStatus: string;
  confirmText: string;
  trackingText: string;
  reviewText: string;
  reviewComment: string | null;
  courierComment: string | null;
  changedBy?: string;
};

type TrackingRecord = {
  courier_date: string | null;
  courier_name: string | null;
  courier_charge: number | null;
  tracking_id: string | null;
  tracking_url: string | null;
  tracking_status: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
};

type CommunicationRecord = {
  confirm_txt_status: string | null;
  tracking_txt_status: string | null;
  review_txt_status: string | null;
};

type ReviewCommentRecord = {
  id: string;
  comment: string;
};

function normalizeText(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

function valueChanged(oldValue: unknown, newValue: unknown) {
  return String(oldValue ?? "") !== String(newValue ?? "");
}

function auditRow(entityType: string, entityId: string, fieldName: string, oldValue: unknown, newValue: unknown, changedBy: string) {
  return {
    entity_type: entityType,
    entity_id: entityId,
    field_name: fieldName,
    old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
    new_value: newValue === null || newValue === undefined ? null : String(newValue),
    changed_by: changedBy
  };
}

async function getDuplicateTrackingWarning(orderId: string, trackingId: string | null) {
  if (!trackingId) {
    return null;
  }

  const supabase = createServerSupabaseClient();
  const duplicateResponse = await supabase
    .from("order_tracking")
    .select("order_id, orders(order_name)")
    .eq("tracking_id", trackingId)
    .neq("order_id", orderId)
    .limit(5)
    .returns<Array<{ order_id: string; orders: { order_name: string } | Array<{ order_name: string }> | null }>>();

  if (duplicateResponse.error || !duplicateResponse.data?.length) {
    return null;
  }

  const orderNames = duplicateResponse.data.map((row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    return order?.order_name ?? row.order_id;
  });

  return `Tracking ID ${trackingId} is already used by ${orderNames.join(", ")}.`;
}

export async function updateOrderOperations(
  orderId: string,
  input: OrderOperationInput
): Promise<{ row: ReportRow; warning: string | null }> {
  const supabase = createServerSupabaseClient();
  const changedBy = input.changedBy?.trim() || "Local Admin";

  const [trackingResponse, communicationResponse, reviewCommentResponse] = await Promise.all([
    supabase
      .from("order_tracking")
      .select("courier_date, courier_name, courier_charge, tracking_id, tracking_url, tracking_status, delivery_date, delivery_status")
      .eq("order_id", orderId)
      .maybeSingle<TrackingRecord>(),
    supabase
      .from("order_communication")
      .select("confirm_txt_status, tracking_txt_status, review_txt_status")
      .eq("order_id", orderId)
      .maybeSingle<CommunicationRecord>(),
    supabase
      .from("order_comments")
      .select("id, comment")
      .eq("order_id", orderId)
      .eq("comment_type", "Review")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ReviewCommentRecord>()
  ]);

  if (trackingResponse.error) {
    throw new Error(trackingResponse.error.message);
  }

  if (communicationResponse.error) {
    throw new Error(communicationResponse.error.message);
  }

  if (reviewCommentResponse.error) {
    throw new Error(reviewCommentResponse.error.message);
  }

  const courierName = normalizeText(input.courierName);
  const trackingId = normalizeText(input.trackingId);
  const trackingPayload = {
    order_id: orderId,
    courier_date: input.courierDate,
    courier_name: courierName,
    courier_charge: input.courierCharge,
    tracking_id: trackingId,
    tracking_url: resolveTrackingUrl(courierName, trackingId, input.trackingUrl),
    tracking_status: input.trackingStatus,
    delivery_date: input.deliveryDate,
    delivery_status: input.deliveryStatus
  };

  const communicationPayload = {
    order_id: orderId,
    confirm_txt_status: input.confirmText,
    tracking_txt_status: input.trackingText,
    review_txt_status: input.reviewText
  };

  const previousTracking = trackingResponse.data;
  const previousCommunication = communicationResponse.data;
  const auditRows = [
    ["Tracking", "courier_date", previousTracking?.courier_date ?? null, trackingPayload.courier_date],
    ["Tracking", "courier_name", previousTracking?.courier_name ?? null, trackingPayload.courier_name],
    ["Tracking", "courier_charge", previousTracking?.courier_charge ?? null, trackingPayload.courier_charge],
    ["Tracking", "tracking_id", previousTracking?.tracking_id ?? null, trackingPayload.tracking_id],
    ["Tracking", "tracking_url", previousTracking?.tracking_url ?? null, trackingPayload.tracking_url],
    ["Tracking", "tracking_status", previousTracking?.tracking_status ?? "Pending", trackingPayload.tracking_status],
    ["Tracking", "delivery_date", previousTracking?.delivery_date ?? null, trackingPayload.delivery_date],
    ["Tracking", "delivery_status", previousTracking?.delivery_status ?? "Pending", trackingPayload.delivery_status],
    [
      "Communication",
      "confirm_txt_status",
      previousCommunication?.confirm_txt_status ?? "Pending",
      communicationPayload.confirm_txt_status
    ],
    [
      "Communication",
      "tracking_txt_status",
      previousCommunication?.tracking_txt_status ?? "Pending",
      communicationPayload.tracking_txt_status
    ],
    [
      "Communication",
      "review_txt_status",
      previousCommunication?.review_txt_status ?? "Pending",
      communicationPayload.review_txt_status
    ]
  ]
    .filter(([, , oldValue, newValue]) => valueChanged(oldValue, newValue))
    .map(([entityType, fieldName, oldValue, newValue]) =>
      auditRow(entityType as string, orderId, fieldName as string, oldValue, newValue, changedBy)
    );

  const trackingSave = await supabase.from("order_tracking").upsert(trackingPayload, { onConflict: "order_id" });

  if (trackingSave.error) {
    throw new Error(trackingSave.error.message);
  }

  const communicationSave = await supabase
    .from("order_communication")
    .upsert(communicationPayload, { onConflict: "order_id" });

  if (communicationSave.error) {
    throw new Error(communicationSave.error.message);
  }

  const reviewComment = normalizeText(input.reviewComment);
  const previousReviewComment = reviewCommentResponse.data;

  if (valueChanged(previousReviewComment?.comment ?? null, reviewComment)) {
    if (reviewComment && previousReviewComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .update({
          comment: reviewComment,
          created_by: changedBy
        })
        .eq("id", previousReviewComment.id);

      if (commentResponse.error) {
        throw new Error(commentResponse.error.message);
      }

      auditRows.push(
        auditRow("Comment", previousReviewComment.id, "comment", previousReviewComment.comment, reviewComment, changedBy)
      );
    } else if (reviewComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .insert({
          order_id: orderId,
          comment_type: "Review",
          comment: reviewComment,
          created_by: changedBy
        })
        .select("id")
        .single<{ id: string }>();

      if (commentResponse.error || !commentResponse.data) {
        throw new Error(commentResponse.error?.message ?? "Could not save review comment.");
      }

      auditRows.push(auditRow("Comment", commentResponse.data.id, "comment", null, reviewComment, changedBy));
    } else if (previousReviewComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .delete()
        .eq("order_id", orderId)
        .eq("comment_type", "Review");

      if (commentResponse.error) {
        throw new Error(commentResponse.error.message);
      }

      auditRows.push(auditRow("Comment", previousReviewComment.id, "comment", previousReviewComment.comment, null, changedBy));
    }
  }

  const courierCommentResponse = await supabase
    .from("order_comments")
    .select("id, comment")
    .eq("order_id", orderId)
    .eq("comment_type", "Courier Issue")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ReviewCommentRecord>();

  if (courierCommentResponse.error) {
    throw new Error(courierCommentResponse.error.message);
  }

  const courierComment = normalizeText(input.courierComment);
  const previousCourierComment = courierCommentResponse.data;

  if (valueChanged(previousCourierComment?.comment ?? null, courierComment)) {
    if (courierComment && previousCourierComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .update({
          comment: courierComment,
          created_by: changedBy
        })
        .eq("id", previousCourierComment.id);

      if (commentResponse.error) {
        throw new Error(commentResponse.error.message);
      }

      auditRows.push(
        auditRow("Comment", previousCourierComment.id, "comment", previousCourierComment.comment, courierComment, changedBy)
      );
    } else if (courierComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .insert({
          order_id: orderId,
          comment_type: "Courier Issue",
          comment: courierComment,
          created_by: changedBy
        })
        .select("id")
        .single<{ id: string }>();

      if (commentResponse.error || !commentResponse.data) {
        throw new Error(commentResponse.error?.message ?? "Could not save courier comment.");
      }

      auditRows.push(auditRow("Comment", commentResponse.data.id, "comment", null, courierComment, changedBy));
    } else if (previousCourierComment) {
      const commentResponse = await supabase
        .from("order_comments")
        .delete()
        .eq("order_id", orderId)
        .eq("comment_type", "Courier Issue");

      if (commentResponse.error) {
        throw new Error(commentResponse.error.message);
      }

      auditRows.push(
        auditRow("Comment", previousCourierComment.id, "comment", previousCourierComment.comment, null, changedBy)
      );
    }
  }

  if (auditRows.length) {
    const auditResponse = await supabase.from("audit_logs").insert(auditRows);

    if (auditResponse.error) {
      throw new Error(auditResponse.error.message);
    }
  }

  const warning = await getDuplicateTrackingWarning(orderId, trackingPayload.tracking_id);
  const row = await getOrderReportRow(orderId);

  return { row, warning };
}
