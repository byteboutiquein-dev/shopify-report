import { after, NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { checkOrderTrackingStatuses } from "@/lib/orders/tracking-status";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unauthorized scheduled courier status request."
      },
      { status: 401 }
    );
  }

  const startedAt = new Date().toISOString();

  after(async () => {
    try {
      const courierSync = await checkOrderTrackingStatuses([], {
        includeDelivered: false,
        source: "Scheduled"
      });
      console.log("Scheduled courier status sync finished", {
        checked: courierSync.checked,
        failed: courierSync.failed,
        queued: courierSync.queued,
        updated: courierSync.updated
      });
    } catch (error) {
      console.error("Scheduled courier status sync failed", error);
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Scheduled courier status sync accepted. Tracking checks will continue in the background with a 10 second gap between orders.",
    ranAt: startedAt
  }, { status: 202 });
}
