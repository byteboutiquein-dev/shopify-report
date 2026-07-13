import { NextResponse } from "next/server";
import { z } from "zod";

import { updateOrderOperations } from "@/lib/orders/operations";

const nullableDate = z.union([z.string().date(), z.literal(""), z.null(), z.undefined()]).transform((value) => value || null);
const nullableText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
});
const nullableMoney = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? null : value),
  z.union([
    z.number().min(0),
    z.string().trim().regex(/^\d+(\.\d+)?$/).transform(Number),
    z.null()
  ])
);

const operationSchema = z.object({
  courierDate: nullableDate,
  courierName: nullableText,
  courierCharge: nullableMoney,
  trackingId: nullableText,
  trackingUrl: nullableText,
  trackingStatus: z.enum(["Pending", "Sent", "In Transit", "Delivered", "Failed"]),
  deliveryDate: nullableDate,
  deliveryStatus: z.enum(["Pending", "In Transit", "Delivered", "Returned", "Issue"]),
  confirmText: z.enum(["Pending", "Sent", "Failed", "Not Needed"]),
  trackingText: z.enum(["Pending", "Sent", "Failed", "Not Needed"]),
  reviewText: z.enum(["Pending", "Sent", "Received", "Failed", "Not Needed"]),
  reviewComment: nullableText,
  courierComment: nullableText,
  changedBy: z.string().trim().optional()
});

export async function PATCH(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const payload = operationSchema.safeParse(await request.json().catch(() => ({})));

  if (!payload.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid order update.",
        issues: payload.error.issues
      },
      { status: 400 }
    );
  }

  try {
    const result = await updateOrderOperations(orderId, payload.data);

    return NextResponse.json({
      ok: true,
      row: result.row,
      warning: result.warning
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Could not update order operations."
      },
      { status: 400 }
    );
  }
}
