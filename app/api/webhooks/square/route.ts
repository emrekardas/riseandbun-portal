import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureCacheStarted } from "@/lib/realtime/orders-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Square webhook receiver.
 *
 * Square POSTs JSON when subscribed events fire. We verify the
 * `x-square-hmacsha256-signature` header by HMAC-signing the
 * notification URL + raw body with the webhook signature key
 * (set in Square Dashboard → Webhooks → Subscriptions).
 *
 * On a verified `order.*` or `payment.*` event we kick the
 * server-side cache to refresh now — the diff will broadcast to
 * every connected SSE client within milliseconds.
 *
 * Square retries failed deliveries for up to 24 hours, so we
 * dedupe by `event_id` to avoid double-processing.
 *
 * Required env:
 *   SQUARE_WEBHOOK_SIGNATURE_KEY  — copy from Square Dashboard
 *   SQUARE_WEBHOOK_URL            — exact public URL Square calls
 *                                    (must match what's registered)
 *
 * Reference: https://developer.squareup.com/docs/webhooks/step3validate
 */

const RELEVANT_PREFIXES = ["order.", "payment."];

// Bounded LRU-ish set of recently seen event_ids. Square delivers a
// fresh event_id per event; retries reuse the original id.
const SEEN_EVENT_IDS = new Set<string>();
const SEEN_EVENT_IDS_MAX = 500;

function rememberEventId(id: string): boolean {
  if (SEEN_EVENT_IDS.has(id)) return false;
  SEEN_EVENT_IDS.add(id);
  if (SEEN_EVENT_IDS.size > SEEN_EVENT_IDS_MAX) {
    const first = SEEN_EVENT_IDS.values().next().value;
    if (first) SEEN_EVENT_IDS.delete(first);
  }
  return true;
}

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  notificationUrl: string,
  signatureKey: string,
): boolean {
  if (!signatureHeader) return false;
  const hmac = createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type SquareEventPayload = {
  type?: string;
  event_id?: string;
  merchant_id?: string;
  created_at?: string;
};

export async function POST(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL;

  if (!signatureKey || !notificationUrl) {
     
    console.warn(
      "[webhooks/square] missing SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_URL",
    );
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-square-hmacsha256-signature");

  const ok = verifySignature(
    rawBody,
    signatureHeader,
    notificationUrl,
    signatureKey,
  );
  if (!ok) {
    // Square docs prescribe 403 Forbidden for invalid signatures.
    return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
  }

  let payload: SquareEventPayload = {};
  try {
    payload = JSON.parse(rawBody) as SquareEventPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const retryNumber = request.headers.get("square-retry-number");
  const retryReason = request.headers.get("square-retry-reason");
  if (retryNumber) {
     
    console.warn(
      `[webhooks/square] retry #${retryNumber} (${retryReason ?? "unknown"}) for event ${payload.event_id ?? "?"}`,
    );
  }

  // Idempotency — Square may redeliver the same event_id during the
  // 24-hour retry window.
  const eventId = payload.event_id;
  const isFresh = eventId ? rememberEventId(eventId) : true;

  const type = payload.type ?? "";
  const isRelevant = RELEVANT_PREFIXES.some((p) => type.startsWith(p));

  if (isRelevant && isFresh) {
    const cache = ensureCacheStarted();
    // Don't await — respond fast so Square doesn't retry. The refresh
    // will broadcast via the event bus when it completes (~hundreds of ms).
    void cache.refreshNow();
  }

  return NextResponse.json({
    ok: true,
    handled: isRelevant,
    duplicate: !isFresh,
  });
}
