const TRACK_COURIER_BASE_URL = "https://trackcourier.co/track-and-trace";
const MYSPEEDPOST_BASE_URL = "https://myspeedpost.com/s";
const TRACK91_BASE_URL = "https://track91.com";

export const supportedCourierOptions = [
  { label: "DTDC", value: "DTDC India" },
  { label: "ST Courier", value: "ST Courier" },
  { label: "Professional Couriers", value: "Professional Couriers" },
  { label: "India Post", value: "India Post Domestic" }
] as const;

const carrierSlugMatchers: Array<{ slug: string; patterns: RegExp[] }> = [
  { slug: "dtdc", patterns: [/\bdtdc\b/i] },
  { slug: "st-courier", patterns: [/\bst\s*courier\b/i, /^other$/i] },
  { slug: "professional-courier", patterns: [/\bprofessional\b/i] },
  { slug: "india-post-international", patterns: [/\bindia\s*post\s*international\b/i] },
  { slug: "india-post-domestic", patterns: [/\bindia\s*post\b/i, /\bspeed\s*post\b/i] }
];

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

export function getTrackCourierSlug(courierName: string | null | undefined) {
  const normalized = normalizeText(courierName);

  if (!normalized) {
    return null;
  }

  return carrierSlugMatchers.find((carrier) => carrier.patterns.some((pattern) => pattern.test(normalized)))?.slug ?? null;
}

export function isIndiaPostTrackCourierSlug(slug: string | null | undefined) {
  return slug === "india-post-domestic" || slug === "india-post-international";
}

export function isDtdcTrackCourierSlug(slug: string | null | undefined) {
  return slug === "dtdc";
}

function buildTrack91Url(slug: "dtdc" | "st-courier", trackingId: string) {
  return `${TRACK91_BASE_URL}/${slug}/track?n=${encodeURIComponent(trackingId)}`;
}

export function buildTrackCourierUrl(courierName: string | null | undefined, trackingId: string | null | undefined) {
  const slug = getTrackCourierSlug(courierName);
  const normalizedTrackingId = normalizeText(trackingId);

  if (!slug || !normalizedTrackingId) {
    return null;
  }

  if (isIndiaPostTrackCourierSlug(slug)) {
    return `${MYSPEEDPOST_BASE_URL}/${encodeURIComponent(normalizedTrackingId)}`;
  }

  if (isDtdcTrackCourierSlug(slug)) {
    return buildTrack91Url("dtdc", normalizedTrackingId);
  }

  if (slug === "st-courier") {
    return buildTrack91Url("st-courier", normalizedTrackingId);
  }

  return `${TRACK_COURIER_BASE_URL}/${slug}/${encodeURIComponent(normalizedTrackingId)}`;
}

export function resolveTrackingUrl(
  courierName: string | null | undefined,
  trackingId: string | null | undefined,
  existingUrl?: string | null
) {
  const slug = getTrackCourierSlug(courierName);
  const generatedUrl = buildTrackCourierUrl(courierName, trackingId);

  if (
    isIndiaPostTrackCourierSlug(slug) ||
    isDtdcTrackCourierSlug(slug) ||
    slug === "st-courier"
  ) {
    return generatedUrl ?? normalizeText(existingUrl);
  }

  return generatedUrl ?? normalizeText(existingUrl);
}
