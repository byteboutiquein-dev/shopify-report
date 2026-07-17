import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrdersReportRows, getOrdersReportSummary } from "@/lib/orders/report";

const reportQuerySchema = z.object({
  courierName: z.string().optional().default(""),
  currentDate: z.string().optional().default(""),
  deliveryDelayDays: z.coerce.number().int().min(1).max(30).default(4),
  deliveryStatus: z.string().optional().default(""),
  delayStatus: z.string().optional().default(""),
  endDate: z.string().optional().default(""),
  focusStatus: z.string().optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(100),
  search: z.string().optional().default(""),
  sortKey: z
    .enum(["date-desc", "date-asc", "order-desc", "order-asc", "name-asc", "courier-asc", "delivery-asc"])
    .default("date-desc"),
  startDate: z.string().optional().default("")
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = reportQuerySchema.safeParse(Object.fromEntries(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: parsed.error.issues[0]?.message ?? "Invalid report query.",
        ok: false
      },
      { status: 400 }
    );
  }

  const [report, summary] = await Promise.all([
    getOrdersReportRows({
      courierName: parsed.data.courierName || undefined,
      currentDate: parsed.data.currentDate || undefined,
      deliveryDelayDays: parsed.data.deliveryDelayDays,
      deliveryStatus: parsed.data.deliveryStatus || undefined,
      delayStatus: parsed.data.delayStatus || undefined,
      endDate: parsed.data.endDate || undefined,
      focusStatus: parsed.data.focusStatus || undefined,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      search: parsed.data.search || undefined,
      sortKey: parsed.data.sortKey,
      startDate: parsed.data.startDate || undefined
    }),
    getOrdersReportSummary({
      currentDate: parsed.data.currentDate || new Date().toISOString().slice(0, 10),
      deliveryDelayDays: parsed.data.deliveryDelayDays,
      endDate: parsed.data.endDate || undefined,
      startDate: parsed.data.startDate || undefined
    })
  ]);

  if (report.error || summary.error) {
    return NextResponse.json(
      {
        message: report.error ?? summary.error,
        ok: false,
        duplicateTrackingEntries: report.duplicateTrackingEntries,
        rows: [],
        summary: summary.summary,
        totalRows: 0
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    duplicateTrackingEntries: report.duplicateTrackingEntries,
    ok: true,
    rows: report.rows,
    summary: summary.summary,
    totalRows: report.totalRows
  });
}
