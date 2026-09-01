import "server-only";

import type { CourierStatusResult } from "@/lib/courier/track-courier-status";

const ST_COURIER_ORIGIN = "https://stcourier.com";
const ST_COURIER_TRACK_URL = `${ST_COURIER_ORIGIN}/track/shipment`;
const ST_COURIER_CHECK_URL = `${ST_COURIER_ORIGIN}/track/doCheck`;
const COURIER_FETCH_TIMEOUT_MS = 15_000;

type StCourierCheckResponse = {
  code?: number;
  msg?: string;
};

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
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

async function fetchWithSession(cookieJar: Map<string, string>, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookieHeader = serializeCookies(cookieJar);

  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
  });

  mergeCookies(cookieJar, response.headers);
  return response;
}

async function readTextResponse(response: Response, source: string) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${source} failed with HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  return text;
}

function extractTableValue(html: string, label: string) {
  const pattern = new RegExp(`<td[^>]*>\\s*${label}\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const match = html.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  const value = stripTags(match[1]);
  return value.length ? value : null;
}

function parseStCourierDate(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  const numericDate = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);

  if (numericDate) {
    return `${numericDate[3]}-${numericDate[2].padStart(2, "0")}-${numericDate[1].padStart(2, "0")}`;
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapStCourierStatus(rawStatus: string, courierDate: string | null, deliveryDate: string | null): CourierStatusResult {
  const normalized = rawStatus.toLowerCase();
  const delivered = /\bdelivered\b/.test(normalized) && !/\bundelivered\b/.test(normalized);

  if (deliveryDate || delivered) {
    return {
      courierDate,
      deliveryDate,
      deliveryStatus: "Delivered",
      rawStatus,
      trackingStatus: "Delivered"
    };
  }

  if (normalized.includes("return") || normalized.includes("rto") || normalized.includes("undelivered")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Returned",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  if (normalized.includes("hold") || normalized.includes("fail") || normalized.includes("exception")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Issue",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  if (
    normalized.includes("transit") ||
    normalized.includes("forward") ||
    normalized.includes("out for delivery") ||
    normalized.includes("booked")
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

export async function fetchStCourierStatus(trackingId: string): Promise<CourierStatusResult> {
  const normalizedTrackingId = trackingId.trim();

  if (!/^\d{11}$/.test(normalizedTrackingId)) {
    throw new Error("ST Courier needs an 11 digit AWB number.");
  }

  const cookieJar = new Map<string, string>();
  const landingResponse = await fetchWithSession(cookieJar, ST_COURIER_TRACK_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0"
    }
  });
  await readTextResponse(landingResponse, "ST Courier tracking page");

  const formData = new FormData();
  formData.set("awb_no", normalizedTrackingId);

  const checkResponse = await fetchWithSession(cookieJar, ST_COURIER_CHECK_URL, {
    body: formData,
    headers: {
      Origin: ST_COURIER_ORIGIN,
      Referer: ST_COURIER_TRACK_URL,
      "User-Agent": "Mozilla/5.0"
    },
    method: "POST"
  });
  const checkText = await readTextResponse(checkResponse, "ST Courier status request");
  let checkJson: StCourierCheckResponse;

  try {
    checkJson = JSON.parse(checkText) as StCourierCheckResponse;
  } catch {
    throw new Error("ST Courier returned a non-JSON status response.");
  }

  if (checkJson.code !== 200) {
    throw new Error(stripTags(checkJson.msg ?? "ST Courier did not find this AWB number."));
  }

  const resultResponse = await fetchWithSession(cookieJar, ST_COURIER_TRACK_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0"
    }
  });
  const html = await readTextResponse(resultResponse, "ST Courier tracking result");
  const rawStatus = extractTableValue(html, "Current Status");

  if (!rawStatus) {
    throw new Error("ST Courier did not return a tracking status.");
  }

  return mapStCourierStatus(
    rawStatus,
    parseStCourierDate(extractTableValue(html, "Book Date/Time")),
    parseStCourierDate(extractTableValue(html, "Delivery Date/Time"))
  );
}
