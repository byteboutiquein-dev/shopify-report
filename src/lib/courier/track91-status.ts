import "server-only";

import type { CourierStatusResult } from "@/lib/courier/track-courier-status";

const TRACK91_ORIGIN = "https://track91.com";
const TRACK91_LIVEWIRE_UPDATE_URL = `${TRACK91_ORIGIN}/livewire-83ab8104/update`;
const COURIER_FETCH_TIMEOUT_MS = 20_000;

type Track91LivewireResponse = {
  components?: Array<{
    snapshot?: string;
  }>;
};

type Track91Event = {
  event?: string | null;
  event_code?: string | null;
  tracked_at?: string | null;
};

type Track91Result = {
  booked_at?: string | null;
  delivered_at?: string | null;
  delivery_summary?: {
    raw_status?: string | null;
  } | null;
  event_code?: string | null;
  event_raw?: string | null;
  events?: Track91Event[] | null;
  success?: boolean;
};

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function readSetCookies(headers: Headers) {
  const maybeHeadersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof maybeHeadersWithSetCookie.getSetCookie === "function") {
    return maybeHeadersWithSetCookie.getSetCookie();
  }

  const combined = headers.get("set-cookie");

  if (!combined) {
    return [];
  }

  return combined.split(/,(?=\s*[^;,]+=)/);
}

function mergeCookies(cookieJar: Map<string, string>, headers: Headers) {
  for (const setCookie of readSetCookies(headers)) {
    const firstPart = setCookie.split(";")[0];
    const separatorIndex = firstPart.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    cookieJar.set(firstPart.slice(0, separatorIndex).trim(), firstPart.slice(separatorIndex + 1).trim());
  }
}

function serializeCookies(cookieJar: Map<string, string>) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function browserHeaders(extraHeaders: HeadersInit = {}) {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    ...extraHeaders
  };
}

function extractTrackerSnapshot(html: string) {
  const match = html.match(
    /<div[^>]+wire:snapshot="([^"]+)"[^>]+wire:id="([^"]+)"[^>]+wire:name="tracking\.tracker"/
  );

  if (!match?.[1]) {
    throw new Error("Track91 did not return a tracker session.");
  }

  return decodeHtmlEntities(match[1]);
}

function extractCsrfToken(html: string) {
  const token = html.match(/data-csrf="([^"]+)"/)?.[1];

  if (!token) {
    throw new Error("Track91 did not return a CSRF token.");
  }

  return token;
}

async function readTextResponse(response: Response, source: string) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${source} failed with HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return text;
}

function unwrapTrack91Value(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      value[1] &&
      typeof value[1] === "object" &&
      "s" in value[1]
    ) {
      return unwrapTrack91Value(value[0]);
    }

    return value.map((item) => unwrapTrack91Value(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, unwrapTrack91Value(nestedValue)])
    );
  }

  return value;
}

function getDateOnly(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  });

  return formatter.format(date);
}

function findEventDate(events: Track91Event[] | null | undefined, pattern: RegExp) {
  const event = events?.find((item) => pattern.test(`${item.event_code ?? ""} ${item.event ?? ""}`));
  return getDateOnly(event?.tracked_at);
}

function mapTrack91Status(result: Track91Result): CourierStatusResult {
  const rawStatus = (
    result.event_raw ??
    result.delivery_summary?.raw_status ??
    result.events?.[0]?.event ??
    "Pending"
  ).trim();
  const statusText = `${rawStatus} ${result.event_code ?? ""}`.toLowerCase();
  const courierDate = getDateOnly(result.booked_at) ?? findEventDate(result.events, /booked|pickup|created/i);

  if (statusText.includes("deliver")) {
    return {
      courierDate,
      deliveryDate: getDateOnly(result.delivered_at) ?? findEventDate(result.events, /deliver/i),
      deliveryStatus: "Delivered",
      rawStatus,
      trackingStatus: "Delivered"
    };
  }

  if (statusText.includes("return") || statusText.includes("rto")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Returned",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  if (statusText.includes("fail") || statusText.includes("exception") || statusText.includes("hold")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Issue",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  if (
    statusText.includes("transit") ||
    statusText.includes("out_for_delivery") ||
    statusText.includes("out for delivery") ||
    statusText.includes("destination") ||
    statusText.includes("booked") ||
    statusText.includes("pickup")
  ) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "In Transit",
      rawStatus,
      trackingStatus: "In Transit"
    };
  }

  return {
    courierDate,
    deliveryDate: null,
    deliveryStatus: "Pending",
    rawStatus,
    trackingStatus: "Pending"
  };
}

export async function fetchTrack91Status(
  courierSlug: "dtdc" | "st-courier",
  trackingId: string
): Promise<CourierStatusResult> {
  const normalizedTrackingId = trackingId.trim().toUpperCase();
  const courierLabel = courierSlug === "dtdc" ? "DTDC" : "ST Courier";

  if (!normalizedTrackingId) {
    throw new Error(`Track91 needs a ${courierLabel} tracking ID.`);
  }

  const trackingUrl = `${TRACK91_ORIGIN}/${courierSlug}/track?n=${encodeURIComponent(normalizedTrackingId)}`;
  const cookieJar = new Map<string, string>();
  const pageResponse = await fetch(trackingUrl, {
    headers: browserHeaders(),
    signal: AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
  });
  mergeCookies(cookieJar, pageResponse.headers);

  const pageHtml = await readTextResponse(pageResponse, "Track91 tracking page");
  const csrfToken = extractCsrfToken(pageHtml);
  const snapshot = extractTrackerSnapshot(pageHtml);

  const updateResponse = await fetch(TRACK91_LIVEWIRE_UPDATE_URL, {
    body: JSON.stringify({
      _token: csrfToken,
      components: [
        {
          calls: [{ method: "submitTrackRequest", params: ["Asia/Kolkata"], path: "" }],
          snapshot,
          updates: {}
        }
      ]
    }),
    headers: browserHeaders({
      Accept: "*/*",
      "Content-Type": "application/json",
      Cookie: serializeCookies(cookieJar),
      Origin: TRACK91_ORIGIN,
      Referer: trackingUrl,
      "X-Livewire": "1"
    }),
    method: "POST",
    signal: AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
  });
  mergeCookies(cookieJar, updateResponse.headers);

  const updateText = await readTextResponse(updateResponse, "Track91 status request");
  let updateJson: Track91LivewireResponse;

  try {
    updateJson = JSON.parse(updateText) as Track91LivewireResponse;
  } catch {
    throw new Error("Track91 returned a non-JSON status response.");
  }

  const updatedSnapshot = updateJson.components?.[0]?.snapshot;

  if (!updatedSnapshot) {
    throw new Error("Track91 did not return tracking data.");
  }

  const snapshotData = JSON.parse(updatedSnapshot) as { data?: { errorMessage?: string | null; result?: unknown } };

  if (snapshotData.data?.errorMessage) {
    throw new Error(snapshotData.data.errorMessage);
  }

  const result = unwrapTrack91Value(snapshotData.data?.result) as Track91Result | null;

  if (!result?.success) {
    throw new Error(`Track91 did not find this ${courierLabel} shipment.`);
  }

  return mapTrack91Status(result);
}

export function fetchTrack91DtdcStatus(trackingId: string) {
  return fetchTrack91Status("dtdc", trackingId);
}
