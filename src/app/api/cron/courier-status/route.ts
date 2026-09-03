import { after, NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { checkOrderTrackingStatuses, prepareScheduledTrackingCheckRun } from "@/lib/orders/tracking-status";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const preferredRegion = "bom1";

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

  const preparedRun = await prepareScheduledTrackingCheckRun();

  if (!preparedRun.accepted) {
    return NextResponse.json({
      activeLogId: preparedRun.activeLogId,
      logId: preparedRun.logId,
      ok: true,
      skipped: true,
      message: preparedRun.message,
      ranAt: new Date().toISOString(),
      startedAt: preparedRun.startedAt
    }, { status: 202 });
  }

  after(async () => {
    try {
      const courierSync = await checkOrderTrackingStatuses([], {
        includeDelivered: false,
        logId: preparedRun.logId,
        skipActiveRunCheck: true,
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
    logId: preparedRun.logId,
    ok: true,
    message: preparedRun.message,
    ranAt: new Date().toISOString(),
    startedAt: preparedRun.startedAt
  }, { status: 202 });
}
