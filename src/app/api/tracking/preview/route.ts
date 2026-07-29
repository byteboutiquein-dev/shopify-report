import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchTrackCourierStatus } from "@/lib/courier/track-courier-status";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const requestSchema = z.object({
  orderId: z.string().uuid()
});

type TrackingPreviewRow = {
  courier_name: string | null;
  tracking_id: string | null;
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
    .select("courier_name, tracking_id, tracking_url")
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

    return NextResponse.json({
      ok: true,
      details: status.details ?? null,
      status: {
        courierDate: status.courierDate,
        deliveryDate: status.deliveryDate,
        deliveryStatus: status.deliveryStatus,
        rawStatus: status.rawStatus,
        trackingProvider: status.trackingProvider ?? null,
        trackingStatus: status.trackingStatus
      }
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
