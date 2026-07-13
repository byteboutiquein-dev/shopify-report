import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/cron-auth";
import { syncShopifyOrders } from "@/lib/sync/shopify-orders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Unauthorized scheduled order sync request."
      },
      { status: 401 }
    );
  }

  const orderSync = await syncShopifyOrders({
    syncType: "Scheduled"
  });

  return NextResponse.json(
    {
      ok: orderSync.status !== "Failed",
      orderSync,
      ranAt: new Date().toISOString()
    },
    {
      status: orderSync.status === "Failed" ? 500 : 200
    }
  );
}
