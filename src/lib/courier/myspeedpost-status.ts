import "server-only";

import type { CourierStatusResult } from "@/lib/courier/track-courier-status";

const MYSPEEDPOST_BASE_URL = "https://myspeedpost.com/s";
const COURIER_FETCH_TIMEOUT_MS = 15_000;

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function decodeJsonString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function extractFieldValue(html: string, key: string) {
  const pattern = new RegExp(`"key":"${key}","label":"[^"]+","value":(?:"((?:\\\\.|[^"\\\\])*)"|null)`);
  const match = html.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  const decoded = decodeJsonString(match[1]).trim();
  return decoded.length ? decoded : null;
}

function extractTrackingEventDates(html: string) {
  return [...html.matchAll(/"tracked_at":"((?:\\.|[^"\\])*)"/g)]
    .map((match) => decodeJsonString(match[1]).trim())
    .filter(Boolean);
}

function parseMySpeedPostDate(value: string | null) {
  if (!value) {
    return null;
  }

  const isoDate = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoDate) {
    return isoDate[1];
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapMySpeedPostStatus(
  rawStatus: string,
  bookedOn: string | null,
  deliveredAt: string | null,
  lastUpdatedAt: string | null,
  eventDates: string[]
): CourierStatusResult {
  const normalized = rawStatus.toLowerCase();
  const delivered = /\bdelivered\b/.test(normalized) && !/\bundelivered\b/.test(normalized);
  const courierDate =
    parseMySpeedPostDate(bookedOn) ??
    eventDates
      .map((eventDate) => parseMySpeedPostDate(eventDate))
      .filter((eventDate): eventDate is string => Boolean(eventDate))
      .sort()[0] ?? null;

  if (deliveredAt || delivered) {
    return {
      courierDate,
      deliveryDate: parseMySpeedPostDate(deliveredAt ?? lastUpdatedAt),
      deliveryStatus: "Delivered",
      rawStatus,
      trackingStatus: "Delivered"
    };
  }

  if (
    normalized.includes("dispatched") ||
    normalized.includes("received") ||
    normalized.includes("out for delivery") ||
    normalized.includes("bagged") ||
    normalized.includes("transit")
  ) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "In Transit",
      rawStatus,
      trackingStatus: "In Transit"
    };
  }

  if (normalized.includes("returned") || normalized.includes("undelivered")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Returned",
      rawStatus,
      trackingStatus: "Failed"
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

export async function fetchMySpeedPostStatus(trackingId: string): Promise<CourierStatusResult> {
  const normalizedTrackingId = trackingId.trim();

  if (!normalizedTrackingId) {
    throw new Error("MySpeedPost needs a tracking ID.");
  }

  const response = await fetch(`${MYSPEEDPOST_BASE_URL}/${encodeURIComponent(normalizedTrackingId)}`, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`MySpeedPost status check failed with HTTP ${response.status}.`);
  }

  const html = decodeHtmlEntities(await response.text());
  const currentStatus = extractFieldValue(html, "current_status");
  const bookedOn = extractFieldValue(html, "booked_on");
  const deliveredAt = extractFieldValue(html, "delivered_at");
  const lastUpdatedAt = extractFieldValue(html, "last_updated_at");
  const eventDates = extractTrackingEventDates(html);

  if (!currentStatus && !deliveredAt && /not\s+found|no\s+tracking/i.test(html)) {
    return {
      courierDate: null,
      deliveryDate: null,
      deliveryStatus: "Pending",
      rawStatus: "Not found",
      trackingStatus: "Pending"
    };
  }

  if (!currentStatus && !deliveredAt) {
    throw new Error("MySpeedPost did not return tracking status.");
  }

  return mapMySpeedPostStatus(currentStatus ?? "Delivered", bookedOn, deliveredAt, lastUpdatedAt, eventDates);
}
