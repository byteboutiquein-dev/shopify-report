import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { z } from "zod";

import { fetchTrackCourierStatus } from "@/lib/courier/track-courier-status";
import { getTrackCourierSlug, resolveTrackingUrl } from "@/lib/courier/tracking-links";
import { getOrderReportRow } from "@/lib/orders/report";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const requestSchema = z.object({
  orderId: z.string().uuid()
});

type TrackingPreviewRow = {
  courier_date: string | null;
  courier_name: string | null;
  delivery_date: string | null;
  delivery_status: string | null;
  tracking_id: string | null;
  tracking_status: string | null;
  tracking_url: string | null;
};

function getCourierLookupText(courierName: string, trackingId: string, trackingUrl: string | null) {
  if (/^other$/i.test(courierName)) {
    if (/^[A-Z]{2}\d{9}IN$/i.test(trackingId)) {
      return getCourierLookupText("India Post Domestic", trackingId, trackingUrl);
    }

    if (/^POL\d+$/i.test(trackingId)) {
      return getCourierLookupText("Professional Couriers", trackingId, trackingUrl);
    }

    return getCourierLookupText("ST Courier", trackingId, trackingUrl);
  }

  return [courierName, trackingUrl].filter(Boolean).join(" ");
}

function buildTrack91TrackingUrl(slug: "dtdc" | "st-courier", trackingId: string) {
  return `https://track91.com/${slug}/track?n=${encodeURIComponent(trackingId)}`;
}

function buildSpeedPostTrackUrl(trackingId: string) {
  const payload = Buffer.from(JSON.stringify({ c: "dtdc", t: trackingId })).toString("base64");
  return `https://speedposttrack.io/tracking-result?d=${encodeURIComponent(payload)}`;
}

function buildTrackCourierIoUrl(courierName: string, trackingId: string) {
  const slug = getTrackCourierSlug(courierName);

  if (!slug) {
    return null;
  }

  return `https://trackcourier.io/track-and-trace/${slug}/${encodeURIComponent(trackingId)}`;
}

function getProviderTrackingUrl(provider: string | null | undefined, courierName: string, trackingId: string, existingUrl: string | null) {
  const normalizedProvider = provider?.trim().toLowerCase() ?? "";
  const slug = getTrackCourierSlug(courierName);

  if (normalizedProvider === "speedposttrack") {
    return buildSpeedPostTrackUrl(trackingId);
  }

  if (normalizedProvider === "track91") {
    if (slug === "st-courier") {
      return buildTrack91TrackingUrl("st-courier", trackingId);
    }

    if (slug === "dtdc") {
      return buildTrack91TrackingUrl("dtdc", trackingId);
    }
  }

  if (normalizedProvider === "trackcourier") {
    return buildTrackCourierIoUrl(courierName, trackingId) ?? resolveTrackingUrl(courierName, trackingId, existingUrl);
  }

  if (normalizedProvider === "myspeedpost") {
    return `https://myspeedpost.com/s/${encodeURIComponent(trackingId)}`;
  }

  if (normalizedProvider === "st courier") {
    return "https://stcourier.com/track/shipment";
  }

  return resolveTrackingUrl(courierName, trackingId, existingUrl);
}

function keepDeliveredStatus(row: Pick<TrackingPreviewRow, "delivery_status" | "tracking_status">) {
  return row.delivery_status === "Delivered" || row.tracking_status === "Delivered";
}

export async function POST(request: Request) {
  const payload = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!payload.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid tracking preview request.",
        issues: payload.error.issues
      },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();
  const response = await supabase
    .from("order_tracking")
    .select("courier_date, courier_name, delivery_date, delivery_status, tracking_id, tracking_status, tracking_url")
    .eq("order_id", payload.data.orderId)
    .single<TrackingPreviewRow>();

  if (response.error || !response.data) {
    return NextResponse.json(
      {
        ok: false,
        message: response.error?.message ?? "Tracking row was not found."
      },
      { status: 404 }
    );
  }

  const courierName = response.data.courier_name?.trim();
  const trackingId = response.data.tracking_id?.trim();

  if (!courierName || !trackingId) {
    return NextResponse.json(
      {
        ok: false,
        message: !courierName ? "Courier name is missing." : "Tracking ID is missing."
      },
      { status: 400 }
    );
  }

  try {
    const status = await fetchTrackCourierStatus(
      getCourierLookupText(courierName, trackingId, response.data.tracking_url),
      trackingId
    );
    const checkedAt = new Date().toISOString();
    const trackingUrl = getProviderTrackingUrl(status.trackingProvider, courierName, trackingId, response.data.tracking_url);
    const preserveDelivered = keepDeliveredStatus(response.data) && status.deliveryStatus !== "Delivered";
    const newDeliveryStatus = preserveDelivered ? "Delivered" : status.deliveryStatus;
    const newTrackingStatus = preserveDelivered ? "Delivered" : status.trackingStatus;
    const finalDeliveryDate =
      newDeliveryStatus === "Delivered" || newDeliveryStatus === "Returned"
        ? status.deliveryDate ?? response.data.delivery_date
        : response.data.delivery_date;
    const updateResponse = await supabase
      .from("order_tracking")
      .update({
        courier_date: response.data.courier_date ?? status.courierDate,
        delivery_date: finalDeliveryDate,
        delivery_status: newDeliveryStatus,
        tracking_checked_at: checkedAt,
        tracking_check_error: null,
        tracking_check_source: "Manual",
        tracking_provider: status.trackingProvider ?? null,
        tracking_status: newTrackingStatus,
        tracking_url: trackingUrl
      })
      .eq("order_id", payload.data.orderId);

    if (updateResponse.error) {
      throw new Error(updateResponse.error.message);
    }

    const updatedRow = await getOrderReportRow(payload.data.orderId);

    return NextResponse.json({
      ok: true,
      details: status.details ?? null,
      status: {
        courierDate: status.courierDate,
        deliveryDate: finalDeliveryDate,
        deliveryStatus: newDeliveryStatus,
        rawStatus: status.rawStatus,
        trackingProvider: status.trackingProvider ?? null,
        trackingUrl,
        trackingStatus: newTrackingStatus
      },
      updatedRow
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Could not fetch live tracking preview."
      },
      { status: 400 }
    );
  }
}
