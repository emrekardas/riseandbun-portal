import { NextResponse } from "next/server";
import { getEventBus, type OrderEvent } from "@/lib/realtime/event-bus";
import { ensureCacheStarted } from "@/lib/realtime/orders-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseFormat(event: OrderEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request) {
  const cache = ensureCacheStarted();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const status = cache.status();
      if (status.ready) {
        safeEnqueue(
          sseFormat({
            type: "snapshot",
            orders: cache.snapshot(),
            at: status.lastFetchedAt ?? new Date().toISOString(),
          }),
        );
      } else {
        // Cache not ready yet — kick a fetch and let the next emit
        // deliver the first snapshot.
        void cache.refreshNow();
      }

      unsubscribe = getEventBus().subscribe((event) => {
        safeEnqueue(sseFormat(event));
      });

      const onAbort = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
