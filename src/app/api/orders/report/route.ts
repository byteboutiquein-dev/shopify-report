import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrdersReportRows } from "@/lib/orders/report";

const reportQuerySchema = z.object({
  endDate: z.string().optional().default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(100),
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

  const report = await getOrdersReportRows({
    endDate: parsed.data.endDate || undefined,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    sortKey: parsed.data.sortKey,
    startDate: parsed.data.startDate || undefined
  });

  if (report.error) {
    return NextResponse.json(
      {
        message: report.error,
        ok: false,
        rows: [],
        totalRows: 0
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    rows: report.rows,
    totalRows: report.totalRows
  });
}
