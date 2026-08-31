import "server-only";

import type { CourierStatusResult } from "@/lib/courier/track-courier-status";

const SPEEDPOSTTRACK_ORIGIN = "https://speedposttrack.io";
const COURIER_FETCH_TIMEOUT_MS = 15_000;
const SOCKET_PACKET_SEPARATOR = String.fromCharCode(30);

type SpeedPostTrackTokenResponse = {
  socketAuth?: {
    expiresAt?: number;
    token?: string;
  };
};

type SpeedPostTrackBookingDetails = {
  booked_on?: string | null;
  delivery_confirmed_on?: string | null;
};

type SpeedPostTrackEvent = {
  date?: string | null;
  event?: string | null;
  status?: string | null;
  time?: string | null;
};

type SpeedPostTrackResponse = {
  data?: {
    booking_details?: SpeedPostTrackBookingDetails | null;
    del_status?: string | null;
    overall_state?: string | null;
    overall_status?: string | null;
    tracking_details?: SpeedPostTrackEvent[] | null;
  };
  provider?: string;
  status?: string;
  trackingNumber?: string;
};

type SocketPacket =
  | {
      eventName: "trackResult";
      payload: SpeedPostTrackResponse;
      type: "event";
    }
  | {
      eventName: "trackError";
      payload: { message?: string };
      type: "event";
    }
  | {
      data: unknown;
      type: "open";
    }
  | {
      type: "connected" | "ok" | "ping" | "unknown";
    };

function encodeTrackingPayload(trackingId: string, courierId: string) {
  const json = JSON.stringify({
    c: courierId,
    t: trackingId
  });

  return Buffer.from(json).toString("base64");
}

function getTrackingResultUrl(trackingId: string, courierId: string) {
  return `${SPEEDPOSTTRACK_ORIGIN}/tracking-result?d=${encodeURIComponent(encodeTrackingPayload(trackingId, courierId))}`;
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

async function readJsonResponse<T>(response: Response, source: string) {
  const text = await readTextResponse(response, source);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${source} returned a non-JSON response.`);
  }
}

function parseEngineIoOpenPacket(packet: string) {
  if (!packet.startsWith("0")) {
    return null;
  }

  try {
    return JSON.parse(packet.slice(1)) as { sid?: string };
  } catch {
    return null;
  }
}

function parseSocketPacket(packet: string): SocketPacket {
  if (packet === "ok") {
    return { type: "ok" };
  }

  if (packet === "2") {
    return { type: "ping" };
  }

  if (packet.startsWith("0")) {
    return {
      data: parseEngineIoOpenPacket(packet),
      type: "open"
    };
  }

  if (packet.startsWith("40")) {
    return { type: "connected" };
  }

  if (packet.startsWith("42")) {
    try {
      const [eventName, payload] = JSON.parse(packet.slice(2)) as [string, unknown];

      if (eventName === "trackResult") {
        return {
          eventName,
          payload: payload as SpeedPostTrackResponse,
          type: "event"
        };
      }

      if (eventName === "trackError") {
        return {
          eventName,
          payload: payload as { message?: string },
          type: "event"
        };
      }
    } catch {
      return { type: "unknown" };
    }
  }

  return { type: "unknown" };
}

function splitSocketPackets(body: string) {
  return body.split(SOCKET_PACKET_SEPARATOR).filter(Boolean).map(parseSocketPacket);
}

async function getSpeedPostTrackToken(cookieJar: Map<string, string>, resultUrl: string) {
  const response = await fetchWithSession(cookieJar, `${SPEEDPOSTTRACK_ORIGIN}/api/token`, {
    body: JSON.stringify({ turnstileToken: null }),
    headers: {
      "Content-Type": "application/json",
      Origin: SPEEDPOSTTRACK_ORIGIN,
      Referer: resultUrl,
      "User-Agent": "Mozilla/5.0"
    },
    method: "POST"
  });
  const tokenResponse = await readJsonResponse<SpeedPostTrackTokenResponse>(response, "SpeedPostTrack token");
  const token = tokenResponse.socketAuth?.token;

  if (!token) {
    throw new Error("SpeedPostTrack did not return a socket token.");
  }

  return token;
}

async function openSocketSession(cookieJar: Map<string, string>) {
  const response = await fetchWithSession(
    cookieJar,
    `${SPEEDPOSTTRACK_ORIGIN}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }
  );
  const body = await readTextResponse(response, "SpeedPostTrack socket open");
  const openPacket = splitSocketPackets(body).find((packet) => packet.type === "open");
  const sid = openPacket?.type === "open" && typeof (openPacket.data as { sid?: string } | null)?.sid === "string"
    ? (openPacket.data as { sid: string }).sid
    : null;

  if (!sid) {
    throw new Error("SpeedPostTrack socket did not return a session ID.");
  }

  return sid;
}

async function postSocketPacket(cookieJar: Map<string, string>, sid: string, packet: string) {
  const response = await fetchWithSession(
    cookieJar,
    `${SPEEDPOSTTRACK_ORIGIN}/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}`,
    {
      body: packet,
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "User-Agent": "Mozilla/5.0"
      },
      method: "POST"
    }
  );
  await readTextResponse(response, "SpeedPostTrack socket post");
}

async function pollSocket(cookieJar: Map<string, string>, sid: string) {
  const response = await fetchWithSession(
    cookieJar,
    `${SPEEDPOSTTRACK_ORIGIN}/socket.io/?EIO=4&transport=polling&sid=${encodeURIComponent(sid)}&t=${Date.now()}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }
  );
  const body = await readTextResponse(response, "SpeedPostTrack socket poll");
  return splitSocketPackets(body);
}

async function waitForSocketConnection(cookieJar: Map<string, string>, sid: string) {
  await postSocketPacket(cookieJar, sid, "40");

  const packets = await pollSocket(cookieJar, sid);

  if (!packets.some((packet) => packet.type === "connected")) {
    throw new Error("SpeedPostTrack socket did not connect.");
  }
}

async function fetchSpeedPostTrackResponse(trackingId: string, courierId: "dtdc") {
  const cookieJar = new Map<string, string>();
  const resultUrl = getTrackingResultUrl(trackingId, courierId);

  const pageResponse = await fetchWithSession(cookieJar, resultUrl, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0"
    }
  });
  await readTextResponse(pageResponse, "SpeedPostTrack result page");

  const token = await getSpeedPostTrackToken(cookieJar, resultUrl);
  const sid = await openSocketSession(cookieJar);
  await waitForSocketConnection(cookieJar, sid);
  await postSocketPacket(
    cookieJar,
    sid,
    `42${JSON.stringify(["track", { courierId, token, trackingNumber: trackingId }])}`
  );

  const startedAt = Date.now();

  while (Date.now() - startedAt < COURIER_FETCH_TIMEOUT_MS) {
    const packets = await pollSocket(cookieJar, sid);

    for (const packet of packets) {
      if (packet.type === "ping") {
        await postSocketPacket(cookieJar, sid, "3");
      }

      if (packet.type === "event" && packet.eventName === "trackError") {
        throw new Error(packet.payload.message || "SpeedPostTrack could not fetch tracking status.");
      }

      if (packet.type === "event" && packet.eventName === "trackResult") {
        return packet.payload;
      }
    }
  }

  throw new Error("SpeedPostTrack tracking request timed out.");
}

function parseSpeedPostTrackDate(value: string | null | undefined) {
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

function isPositiveDeliveredText(value: string) {
  return /\bdelivered\b/i.test(value) && !/\bundelivered\b/i.test(value);
}

function findDeliveredEventDate(events: SpeedPostTrackEvent[]) {
  const matched = events.find((event) => isPositiveDeliveredText([event.event, event.status].filter(Boolean).join(" ")));

  if (!matched) {
    return null;
  }

  return parseSpeedPostTrackDate(matched.date);
}

function findCourierDate(bookingDetails: SpeedPostTrackBookingDetails | null | undefined, events: SpeedPostTrackEvent[]) {
  return (
    parseSpeedPostTrackDate(bookingDetails?.booked_on) ??
    events
      .map((event) => parseSpeedPostTrackDate(event.date))
      .filter((date): date is string => Boolean(date))
      .sort()[0] ??
    null
  );
}

function mapSpeedPostTrackStatus(response: SpeedPostTrackResponse): CourierStatusResult {
  const data = response.data ?? {};
  const bookingDetails = data.booking_details;
  const events = data.tracking_details ?? [];
  const rawStatus = data.overall_status || data.del_status || events[0]?.event || events[0]?.status || "Pending";
  const normalized = [data.overall_state, data.overall_status, data.del_status, rawStatus].filter(Boolean).join(" ").toLowerCase();
  const courierDate = findCourierDate(bookingDetails, events);
  const deliveryDate = parseSpeedPostTrackDate(bookingDetails?.delivery_confirmed_on) ?? findDeliveredEventDate(events);

  if (deliveryDate || isPositiveDeliveredText(normalized)) {
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

  if (normalized.includes("fail") || normalized.includes("exception") || normalized.includes("hold")) {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Issue",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  if (events.length || normalized.includes("transit") || normalized.includes("out for delivery") || normalized.includes("booked")) {
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

export async function fetchSpeedPostTrackDtdcStatus(trackingId: string): Promise<CourierStatusResult> {
  const normalizedTrackingId = trackingId.trim().toUpperCase();

  if (!normalizedTrackingId) {
    throw new Error("SpeedPostTrack needs a DTDC tracking ID.");
  }

  return mapSpeedPostTrackStatus(await fetchSpeedPostTrackResponse(normalizedTrackingId, "dtdc"));
}
