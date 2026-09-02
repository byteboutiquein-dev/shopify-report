import { after, NextResponse } from "next/server";

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

  const startedAt = new Date().toISOString();

  after(async () => {
    try {
      const result = await syncShopifyOrders({
        syncType: "Scheduled"
      });
      console.log("Scheduled Shopify order sync finished", {
        checked: result.ordersChecked,
        inserted: result.ordersInserted,
        status: result.status,
        updated: result.ordersUpdated
      });
    } catch (error) {
      console.error("Scheduled Shopify order sync failed", error);
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Scheduled Shopify order sync accepted. Order sync will continue in the background.",
    ranAt: startedAt
  }, { status: 202 });
}
