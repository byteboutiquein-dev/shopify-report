import { NextResponse } from "next/server";
import { z } from "zod";

import { saveAppSettings } from "@/lib/app-settings";

const settingsRequestSchema = z.object({
  deliveryDelayDays: z.coerce.number().int().min(1).max(30),
  shopifyTrackingRefreshLimit: z.coerce.number().int().min(1).max(5000)
});

export async function PATCH(request: Request) {
  const payload = settingsRequestSchema.safeParse(await request.json().catch(() => ({})));

  if (!payload.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid settings request.",
        issues: payload.error.issues
      },
      { status: 400 }
    );
  }

  try {
    const settings = await saveAppSettings(payload.data);

    return NextResponse.json({
      ok: true,
      settings
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Could not save settings."
      },
      { status: 400 }
    );
  }
}
