import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./lib/auth";
import "./index.css";
import { AccountingPage, AccountLedgerPage } from "./pages/Accounting";
import { CustomerDetailPage, CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { InventoryPage, ProductDetailPage } from "./pages/Inventory";
import { PurchaseOrderDetailPage, PurchaseOrdersPage } from "./pages/Purchasing";
import { ReceivablesPage } from "./pages/Receivables";
import { SalesOrderDetailPage, SalesOrdersPage } from "./pages/SalesOrders";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
});

function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-2 inline-block text-sm text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="sales-orders" element={<SalesOrdersPage />} />
                <Route path="sales-orders/:id" element={<SalesOrderDetailPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:id" element={<CustomerDetailPage />} />
                <Route path="receivables" element={<ReceivablesPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="inventory/products/:id" element={<ProductDetailPage />} />
                <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
                <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
                <Route path="accounting" element={<AccountingPage />} />
                <Route path="accounting/accounts/:code" element={<AccountLedgerPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
