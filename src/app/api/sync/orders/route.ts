import { NextResponse } from "next/server";
import { z } from "zod";

import { syncShopifyOrders } from "@/lib/sync/shopify-orders";

const syncRequestSchema = z.object({
  afterOrderName: z.string().optional().or(z.literal(""))
});

export async function POST(request: Request) {
  const payload = syncRequestSchema.safeParse(await request.json().catch(() => ({})));

  if (!payload.success) {
    return NextResponse.json(
      {
        status: "Failed",
        message: "Invalid sync request.",
        issues: payload.error.issues
      },
      { status: 400 }
    );
  }

  const result = await syncShopifyOrders({
    afterOrderName: payload.data.afterOrderName || undefined
  });

  return NextResponse.json(result, {
    status: result.status === "Failed" ? 400 : 200
  });
}
