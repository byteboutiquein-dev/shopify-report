import { NextResponse } from "next/server";

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

  const courierSync = await checkOrderTrackingStatuses([], {
    includeDelivered: false,
    source: "Scheduled"
  });

  return NextResponse.json({
    ok: true,
    courierSync,
    ranAt: new Date().toISOString()
  });
}
