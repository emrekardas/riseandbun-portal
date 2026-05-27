import { OrdersProvider } from "@/lib/orders/orders-context";
import { Header } from "./_components/header";
import { KdsBoard } from "./_components/kds-board";

export default function HomePage() {
  return (
    <OrdersProvider>
      <div className="flex flex-1 flex-col bg-[var(--surface-canvas)] text-[var(--text-primary)]">
        <Header />
        <KdsBoard />
      </div>
    </OrdersProvider>
  );
}
