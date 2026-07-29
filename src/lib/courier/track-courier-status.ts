import "server-only";

import { createHash } from "node:crypto";

import { fetchMySpeedPostStatus } from "@/lib/courier/myspeedpost-status";
import { fetchSpeedPostTrackDtdcStatus } from "@/lib/courier/speedposttrack-status";
import { fetchStCourierStatus } from "@/lib/courier/st-courier-status";
import { fetchTrack91DtdcStatus, fetchTrack91Status } from "@/lib/courier/track91-status";
import { getTrackCourierSlug, isIndiaPostTrackCourierSlug } from "@/lib/courier/tracking-links";

const TRACK_COURIER_ORIGIN = "https://trackcourier.io";
const TRACK_COURIER_API_KEY = "2fad32ac0dc2be4361243de0b4115d47";
const COURIER_FETCH_TIMEOUT_MS = 15_000;

type ChallengeResponse = {
  challenge: string;
  difficulty: number;
};

type TrackCourierCheckpoint = {
  Date?: string;
  CheckpointState?: string;
};

type TrackCourierResponse = {
  AdditionalInfo?: string;
  Checkpoints?: TrackCourierCheckpoint[];
  MostRecentStatus?: string;
  ShipmentState?: string;
  is_pending?: boolean;
};

export type CourierTrackingEvent = {
  event: string;
  eventCode: string | null;
  location: string | null;
  nextLocation: string | null;
  remarks: string | null;
  trackedAt: string | null;
};

export type CourierTrackingDetails = {
  bookedAt: string | null;
  deliveredAt: string | null;
  destination: string | null;
  estimatedDeliveryDate: string | null;
  events: CourierTrackingEvent[];
  lastEventAt: string | null;
  lastUpdatedAt: string | null;
  origin: string | null;
  pieces: number | null;
  rawStatus: string;
  referenceNumber: string | null;
  scheduledDeliveryDate: string | null;
  weight: string | null;
};

export type CourierStatusResult = {
  courierDate: string | null;
  deliveryDate: string | null;
  deliveryStatus: "Pending" | "In Transit" | "Delivered" | "Returned" | "Issue";
  details?: CourierTrackingDetails;
  rawStatus: string;
  trackingStatus: "Pending" | "Sent" | "In Transit" | "Delivered" | "Failed";
};

function hexToBinary(hex: string) {
  return Array.from(Buffer.from(hex, "hex"))
    .map((byte) => byte.toString(2).padStart(8, "0"))
    .join("");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function solveChallenge(challenge: string, difficulty: number) {
  const prefix = "0".repeat(difficulty);

  for (let nonce = 0; nonce < 2_000_000; nonce += 1) {
    const hash = sha256(`${challenge}${nonce}`);

    if (hexToBinary(hash).startsWith(prefix)) {
      return { hash, nonce };
    }
  }

  throw new Error("TrackCourier proof-of-work challenge timed out.");
}

async function readJsonResponse<T>(response: Response, source: string) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(`${source} returned an empty response.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${source} returned a non-JSON response.`);
  }
}

async function getProofOfWorkPayload() {
  const response = await fetch(`${TRACK_COURIER_ORIGIN}/get-challenge`, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    signal: AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`TrackCourier challenge failed with HTTP ${response.status}.`);
  }

  const challenge = await readJsonResponse<ChallengeResponse>(response, "TrackCourier challenge");
  const solution = await solveChallenge(challenge.challenge, challenge.difficulty);

  return {
    challenge: challenge.challenge,
    hash: solution.hash,
    nonce: solution.nonce
  };
}

function parseTrackCourierDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  const isoDate = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoDate) {
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  const match = normalized.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);

  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };

  if (match) {
    const month = monthMap[match[2].toLowerCase()];

    if (!month) {
      return null;
    }

    return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
  }

  const directDate = new Date(normalized);

  if (Number.isNaN(directDate.getTime())) {
    return null;
  }

  const year = directDate.getFullYear();
  const month = String(directDate.getMonth() + 1).padStart(2, "0");
  const day = String(directDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findDeliveredDate(data: TrackCourierResponse) {
  const deliveredCheckpoint = data.Checkpoints?.find((checkpoint) => checkpoint.CheckpointState === "delivered");
  return parseTrackCourierDate(deliveredCheckpoint?.Date ?? data.Checkpoints?.[0]?.Date);
}

function findCourierDate(data: TrackCourierResponse) {
  const dates = (data.Checkpoints ?? [])
    .map((checkpoint) => parseTrackCourierDate(checkpoint.Date))
    .filter((date): date is string => Boolean(date))
    .sort();

  return dates[0] ?? null;
}

function mapCourierStatus(data: TrackCourierResponse): CourierStatusResult {
  const state = data.ShipmentState?.toLowerCase() ?? "pending";
  const rawStatus = data.MostRecentStatus || data.AdditionalInfo || state || "Pending";
  const courierDate = findCourierDate(data);

  if (state === "delivered" || /delivered/i.test(rawStatus)) {
    return {
      courierDate,
      deliveryDate: findDeliveredDate(data),
      deliveryStatus: "Delivered",
      rawStatus,
      trackingStatus: "Delivered"
    };
  }

  if (state === "intransit" || state === "outfordelivery") {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "In Transit",
      rawStatus,
      trackingStatus: "In Transit"
    };
  }

  if (state === "attemptfail" || state === "error" || state === "exception" || state === "expired") {
    return {
      courierDate,
      deliveryDate: null,
      deliveryStatus: "Issue",
      rawStatus,
      trackingStatus: "Failed"
    };
  }

  return {
    courierDate,
    deliveryDate: null,
    deliveryStatus: "Pending",
    rawStatus,
    trackingStatus: state === "inforeceived" ? "Sent" : "Pending"
  };
}

async function fetchTrackCourierStatusFromTrackCourier(slug: string, trackingId: string): Promise<CourierStatusResult> {
  const proofOfWorkPayload = await getProofOfWorkPayload();
  const response = await fetch(
    `${TRACK_COURIER_ORIGIN}/api/v1/get_checkpoints_table/${TRACK_COURIER_API_KEY}/${slug}/${encodeURIComponent(trackingId)}`,
    {
      body: JSON.stringify(proofOfWorkPayload),
      headers: {
        "Content-Type": "application/json",
        Referer: `${TRACK_COURIER_ORIGIN}/track-and-trace/${slug}/${encodeURIComponent(trackingId)}`,
        "User-Agent": "Mozilla/5.0"
      },
      method: "POST",
      signal: AbortSignal.timeout(COURIER_FETCH_TIMEOUT_MS)
    }
  );

  if (!response.ok) {
    throw new Error(`TrackCourier status check failed with HTTP ${response.status}.`);
  }

  const data = await readJsonResponse<TrackCourierResponse>(response, "TrackCourier status check");

  if (data.is_pending) {
    return {
      courierDate: null,
      deliveryDate: null,
      deliveryStatus: "Pending",
      rawStatus: "Processing",
      trackingStatus: "Pending"
    };
  }

  return mapCourierStatus(data);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function tryCourierProviders(
  providers: Array<{
    fetchStatus: () => Promise<CourierStatusResult>;
    name: string;
  }>
) {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return await provider.fetchStatus();
    } catch (error) {
      errors.push(`${provider.name} failed: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}

export async function fetchTrackCourierStatus(courierName: string, trackingId: string): Promise<CourierStatusResult> {
  const slug = getTrackCourierSlug(courierName);

  if (!slug) {
    throw new Error(`Tracking status is not configured for courier "${courierName}".`);
  }

  if (slug === "dtdc") {
    return tryCourierProviders([
      {
        fetchStatus: () => fetchTrack91DtdcStatus(trackingId),
        name: "Track91"
      },
      {
        fetchStatus: () => fetchSpeedPostTrackDtdcStatus(trackingId),
        name: "SpeedPostTrack"
      },
      {
        fetchStatus: () => fetchTrackCourierStatusFromTrackCourier(slug, trackingId),
        name: "TrackCourier"
      }
    ]);
  }

  if (slug === "st-courier") {
    return tryCourierProviders([
      {
        fetchStatus: () => fetchTrack91Status("st-courier", trackingId),
        name: "Track91"
      },
      {
        fetchStatus: () => fetchStCourierStatus(trackingId),
        name: "ST Courier"
      },
      {
        fetchStatus: () => fetchTrackCourierStatusFromTrackCourier(slug, trackingId),
        name: "TrackCourier"
      }
    ]);
  }

  if (isIndiaPostTrackCourierSlug(slug)) {
    let mySpeedPostError: unknown;

    try {
      return await fetchMySpeedPostStatus(trackingId);
    } catch (error) {
      mySpeedPostError = error;
    }

    try {
      return await fetchTrackCourierStatusFromTrackCourier(slug, trackingId);
    } catch (trackCourierError) {
      throw new Error(
        `MySpeedPost failed: ${getErrorMessage(mySpeedPostError)}; TrackCourier failed: ${getErrorMessage(
          trackCourierError
        )}`
      );
    }
  }

  return fetchTrackCourierStatusFromTrackCourier(slug, trackingId);
}
