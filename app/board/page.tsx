import { OrdersProvider } from "@/lib/orders/orders-context";
import { Header } from "../_components/header";
import { KdsBoard } from "../_components/kds-board";

/**
 * The KDS board. Never linked directly — the proxy rewrites /<tenant>
 * onto this route with the tenant header, so each shop's tablets live at
 * portal.riseandbun.co.uk/<tenant>.
 */
export default function BoardPage() {
  return (
    <OrdersProvider>
      <div className="flex flex-1 flex-col bg-[var(--surface-canvas)] text-[var(--text-primary)]">
        <Header />
        <KdsBoard />
      </div>
    </OrdersProvider>
  );
}
