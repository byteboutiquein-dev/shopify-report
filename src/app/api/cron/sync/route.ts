import { after, NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { runCombinedSync } from "@/lib/sync/combined-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unauthorized scheduled combined sync request."
      },
      { status: 401 }
    );
  }

  const startedAt = new Date().toISOString();

  after(async () => {
    try {
      const result = await runCombinedSync({
        syncType: "Scheduled"
      });
      console.log("Scheduled combined sync finished", {
        courierChecked: result.courierSync?.checked ?? 0,
        courierFailed: result.courierSync?.failed ?? 0,
        courierUpdated: result.courierSync?.updated ?? 0,
        orderStatus: result.orderSync.status,
        status: result.status
      });
    } catch (error) {
      console.error("Scheduled combined sync failed", error);
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Scheduled sync accepted. Shopify order sync and courier tracking will continue in the background.",
    ranAt: startedAt
  }, { status: 202 });
}
