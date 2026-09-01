import { NextResponse } from "next/server";
import { z } from "zod";

import { checkOrderTrackingStatuses } from "@/lib/orders/tracking-status";

export const maxDuration = 300;

const requestSchema = z.object({
  orderIds: z.array(z.string().uuid()).default([])
});

export async function POST(request: Request) {
  const payload = requestSchema.safeParse(await request.json().catch(() => ({})));

  if (!payload.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid tracking status check request.",
        issues: payload.error.issues
      },
      { status: 400 }
    );
  }

  if (!payload.data.orderIds.length) {
    return NextResponse.json(
      {
        ok: false,
        message: "Manual bulk courier status check is disabled. Use the automatic courier cron or check one order from the table."
      },
      { status: 400 }
    );
  }

  try {
    const result = await checkOrderTrackingStatuses(payload.data.orderIds, {
      includeDelivered: true,
      source: "Manual"
    });

    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Could not check tracking statuses."
      },
      { status: 400 }
    );
  }
}
