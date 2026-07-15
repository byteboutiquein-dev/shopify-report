import { NextResponse } from "next/server";

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

  const result = await runCombinedSync({
    syncType: "Scheduled"
  });

  return NextResponse.json(
    {
      ok: result.status !== "Failed",
      ...result
    },
    {
      status: result.status === "Failed" ? 500 : 200
    }
  );
}
