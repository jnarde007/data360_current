import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScrollToTop } from "@/components/ScrollToTop";
import { BackToTopButton } from "@/components/BackToTopButton";

import LandingPage from "./pages/LandingPage";
import CustomerAuthPage from "./pages/CustomerAuthPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AdminLoginPage from "./pages/AdminLoginPage";
import CustomerDashboard from "./pages/CustomerDashboard";
import BuyDataPage from "./pages/BuyDataPage";
import OrdersPage from "./pages/OrdersPage";
import RefundsPage from "./pages/RefundsPage";
import DeveloperApiPage from "./pages/DeveloperApiPage";
import DeveloperApiDocsPage from "./pages/DeveloperApiDocsPage";
import TopupPage from "./pages/TopupPage";
import WalletPage from "./pages/WalletPage";
import AccountPage from "./pages/AccountPage";
import AffiliatePage from "./pages/AffiliatePage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AdminCustomersPage from "./pages/admin/AdminCustomersPage";
import AdminTopupsPage from "./pages/admin/AdminTopupsPage";
import AdminOrdersPage from "./pages/admin/AdminOrdersPage";
import AdminPricingPage from "./pages/admin/AdminPricingPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import AdminAdminsPage from "./pages/admin/AdminAdminsPage";
import AdminProfitPage from "./pages/admin/AdminProfitPage";
import AdminAffiliatePage from "./pages/admin/AdminAffiliatePage";
import AdminApiPage from "./pages/admin/AdminApiPage";
import AdminProviderBalancesPage from "./pages/admin/AdminProviderBalancesPage";
import AdminPayoutsPage from "./pages/admin/AdminPayoutsPage";
import AdminWalletLedgerPage from "./pages/admin/AdminWalletLedgerPage";
import AdminReconciliationPage from "./pages/admin/AdminReconciliationPage";
import AdminHealthCheckPage from "./pages/admin/AdminHealthCheckPage";
import AdminCustomerDetailPage from "./pages/admin/AdminCustomerDetailPage";
import AdminReferralLeaderboardPage from "./pages/admin/AdminReferralLeaderboardPage";
import AdminSupportPage from "./pages/admin/AdminSupportPage";
import AdminReportsPage from "./pages/admin/AdminReportsPage";
import AdminCheckersPage from "./pages/admin/AdminCheckersPage";
import SupportPage from "./pages/SupportPage";
import CheckerPage from "./pages/CheckerPage";
import InstallPage from "./pages/InstallPage";
import AdminPaymentRecoveryPage from "./pages/admin/AdminPaymentRecoveryPage";
import AdminSmsLogsPage from "./pages/admin/AdminSmsLogsPage";
import AdminFulfillmentQueuePage from "./pages/admin/AdminFulfillmentQueuePage";
import NotFound from "./pages/NotFound";
import GuestBuyPage from "./pages/GuestBuyPage";
import GuestSuccessPage from "./pages/GuestSuccessPage";
import GuestTrackPage from "./pages/GuestTrackPage";
import GuestAfaPage from "./pages/GuestAfaPage";
import GuestCheckerPage from "./pages/GuestCheckerPage";
import AfaPage from "./pages/AfaPage";
import AdminAfaPage from "./pages/admin/AdminAfaPage";
import UpdatePrompt from "./components/UpdatePrompt";
import { SiteAnnouncementBanner } from "@/components/SiteAnnouncementBanner";
import InstallHelpDialog from "./components/InstallHelpDialog";
import MyStorePage from "./pages/MyStorePage";
import PublicStorePage from "./pages/PublicStorePage";

import AdminStoresPage from "./pages/admin/AdminStoresPage";
import AdminStoreDetailPage from "./pages/admin/AdminStoreDetailPage";
import AdminCrossNetworkPage from "./pages/admin/AdminCrossNetworkPage";
import AdminSuperAgentsPage from "./pages/admin/AdminSuperAgentsPage";
import AdminApiUsagePage from "./pages/admin/AdminApiUsagePage";
import AdminRefundsPage from "./pages/admin/AdminRefundsPage";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <UpdatePrompt />
          <InstallHelpDialog />
          <BrowserRouter>
            <SiteAnnouncementBanner />
            <ScrollToTop />
            <BackToTopButton />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/auth" element={<CustomerAuthPage />} />
              <Route path="/login" element={<CustomerAuthPage />} />
              <Route path="/signup" element={<CustomerAuthPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/guest-buy" element={<GuestBuyPage />} />
              <Route path="/guest/success" element={<GuestSuccessPage />} />
              <Route path="/guest/track" element={<GuestTrackPage />} />
              <Route path="/guest/afa" element={<GuestAfaPage />} />
              <Route path="/guest/checker" element={<GuestCheckerPage />} />
              <Route path="/admin/login" element={<AdminLoginPage />} />


              {/* Customer routes */}
              <Route path="/dashboard" element={<ProtectedRoute><CustomerDashboard /></ProtectedRoute>} />
              <Route path="/buy-data" element={<ProtectedRoute><BuyDataPage /></ProtectedRoute>} />
              <Route path="/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
              <Route path="/refunds" element={<ProtectedRoute><RefundsPage /></ProtectedRoute>} />
              <Route path="/developer-api" element={<ProtectedRoute><DeveloperApiPage /></ProtectedRoute>} />
              <Route path="/developer-api/docs" element={<ProtectedRoute><DeveloperApiDocsPage /></ProtectedRoute>} />
              <Route path="/topup" element={<ProtectedRoute><TopupPage /></ProtectedRoute>} />
              <Route path="/wallet" element={<ProtectedRoute><WalletPage /></ProtectedRoute>} />
              <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
              <Route path="/affiliate" element={<ProtectedRoute><AffiliatePage /></ProtectedRoute>} />
              <Route path="/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
              <Route path="/checker" element={<ProtectedRoute><CheckerPage /></ProtectedRoute>} />
              <Route path="/afa" element={<ProtectedRoute><AfaPage /></ProtectedRoute>} />
              <Route path="/my-store" element={<ProtectedRoute><MyStorePage /></ProtectedRoute>} />

              {/* Public storefront */}
              
              <Route path="/store/:slug" element={<PublicStorePage />} />
              <Route path="/store/:slug/track" element={<GuestTrackPage />} />


              {/* Admin routes */}
              <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboardPage /></ProtectedRoute>} />
              <Route path="/admin/profit" element={<ProtectedRoute role="admin"><AdminProfitPage /></ProtectedRoute>} />
              <Route path="/admin/customers" element={<ProtectedRoute role="admin"><AdminCustomersPage /></ProtectedRoute>} />
              <Route path="/admin/customers/:customerId" element={<ProtectedRoute role="admin"><AdminCustomerDetailPage /></ProtectedRoute>} />
              <Route path="/admin/topups" element={<ProtectedRoute role="admin"><AdminTopupsPage /></ProtectedRoute>} />
              <Route path="/admin/wallet-ledger" element={<ProtectedRoute role="admin"><AdminWalletLedgerPage /></ProtectedRoute>} />
              <Route path="/admin/orders" element={<ProtectedRoute role="admin"><AdminOrdersPage /></ProtectedRoute>} />
              <Route path="/admin/pricing" element={<ProtectedRoute role="admin"><AdminPricingPage /></ProtectedRoute>} />
              <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminSettingsPage /></ProtectedRoute>} />
              <Route path="/admin/admins" element={<ProtectedRoute role="admin"><AdminAdminsPage /></ProtectedRoute>} />
              <Route path="/admin/affiliates" element={<ProtectedRoute role="admin"><AdminAffiliatePage /></ProtectedRoute>} />
              <Route path="/admin/referral-leaderboard" element={<ProtectedRoute role="admin"><AdminReferralLeaderboardPage /></ProtectedRoute>} />
              <Route path="/admin/api" element={<ProtectedRoute role="admin"><AdminApiPage /></ProtectedRoute>} />
              <Route path="/admin/provider-balances" element={<ProtectedRoute role="admin"><AdminProviderBalancesPage /></ProtectedRoute>} />
              <Route path="/admin/payouts" element={<ProtectedRoute role="admin"><AdminPayoutsPage /></ProtectedRoute>} />
              <Route path="/admin/reconciliation" element={<ProtectedRoute role="admin"><AdminReconciliationPage /></ProtectedRoute>} />
              <Route path="/admin/health-check" element={<ProtectedRoute role="admin"><AdminHealthCheckPage /></ProtectedRoute>} />
              <Route path="/admin/support" element={<ProtectedRoute role="admin"><AdminSupportPage /></ProtectedRoute>} />
              <Route path="/admin/reports" element={<ProtectedRoute role="admin"><AdminReportsPage /></ProtectedRoute>} />
              <Route path="/admin/checkers" element={<ProtectedRoute role="admin"><AdminCheckersPage /></ProtectedRoute>} />
              <Route path="/admin/afa" element={<ProtectedRoute role="admin"><AdminAfaPage /></ProtectedRoute>} />
              <Route path="/admin/payment-recovery" element={<ProtectedRoute role="admin"><AdminPaymentRecoveryPage /></ProtectedRoute>} />
              <Route path="/admin/fulfillment-queue" element={<ProtectedRoute role="admin"><AdminFulfillmentQueuePage /></ProtectedRoute>} />
              <Route path="/admin/sms-logs" element={<ProtectedRoute role="admin"><AdminSmsLogsPage /></ProtectedRoute>} />
              <Route path="/admin/stores" element={<ProtectedRoute role="admin"><AdminStoresPage /></ProtectedRoute>} />
              <Route path="/admin/stores/:storeId" element={<ProtectedRoute role="admin"><AdminStoreDetailPage /></ProtectedRoute>} />
              <Route path="/admin/refunds" element={<ProtectedRoute role="admin"><AdminRefundsPage /></ProtectedRoute>} />
              <Route path="/admin/api-usage" element={<ProtectedRoute role="admin"><AdminApiUsagePage /></ProtectedRoute>} />
              <Route path="/admin/super-agents" element={<ProtectedRoute role="admin"><AdminSuperAgentsPage /></ProtectedRoute>} />
              <Route path="/admin/cross-network" element={<ProtectedRoute role="admin"><AdminCrossNetworkPage /></ProtectedRoute>} />


              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
