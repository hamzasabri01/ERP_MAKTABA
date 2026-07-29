// src/App.jsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { ThemeProvider } from './lib/ThemeContext'
import { I18nProvider, useI18n } from './lib/i18n'
import { NAV_ITEMS } from './components/layout/Layout'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import { PageLoader } from './components/ui/LoadingStates'
import { ConfirmProvider } from './components/ui/ConfirmDialog'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const ClientsPage = lazy(() => import('./pages/ClientsPage'))
const ProductsPage = lazy(() => import('./pages/ProductsPage'))
const SalesPage = lazy(() => import('./pages/SalesPage'))
const POSPage = lazy(() => import('./pages/POSPage'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'))
const StockPage = lazy(() => import('./pages/StockPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const CashPage = lazy(() => import('./pages/CashPage'))
const SecurityCenterPage = lazy(() => import('./pages/SecurityCenterPage'))
const MobileScannerPage = lazy(() => import('./pages/MobileScannerPage'))
const PrinterPage = lazy(() => import('./pages/PrinterPage'))

function RequireAuth({ children }) {
  const { user, loading, sessionExpired } = useAuth()
  if (loading) return <PageLoader title="Verification de session" detail="Chargement des permissions et du profil utilisateur..." />
  if (!user) return <Navigate to="/login" replace state={{ reason: sessionExpired ? 'session-expired' : '' }} />
  return children
}

function AccessDenied() {
  const { t } = useI18n()
  const { hasPermission } = useAuth()
  const firstAllowed = NAV_ITEMS.find(item => hasPermission(item.permission))

  if (firstAllowed) return <Navigate to={firstAllowed.path} replace />

  return (
    <div className="page-content">
      <div className="card">
        <h1 className="page-title">{t('access.deniedTitle')}</h1>
        <p className="text-muted">{t('access.deniedText')}</p>
      </div>
    </div>
  )
}

function RequirePermission({ permission, children }) {
  const { hasPermission } = useAuth()
  if (!hasPermission(permission)) return <AccessDenied />
  return children
}

function DefaultRoute() {
  const { hasPermission } = useAuth()
  const firstAllowed = NAV_ITEMS.find(item => hasPermission(item.permission))
  if (!firstAllowed) return <AccessDenied />
  return <Navigate to={firstAllowed.path} replace />
}

const routePermission = (path) => NAV_ITEMS.find(item => item.path === `/${path}`)?.permission
const protectedPage = (path, element) => (
  <RequirePermission permission={routePermission(path)}>
    {element}
  </RequirePermission>
)

export default function App() {
  const basename = window.location.pathname.startsWith('/erp') ? '/erp' : undefined

  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ConfirmProvider>
            <BrowserRouter basename={basename}>
              <Suspense fallback={<PageLoader title="Chargement" detail="Preparation de la page..." />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/mobile-scanner" element={<MobileScannerPage />} />
                  <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
                    <Route index element={<DefaultRoute />} />
                    <Route path="dashboard"  element={protectedPage('dashboard', <Dashboard />)} />
                    <Route path="clients"    element={protectedPage('clients', <ClientsPage />)} />
                    <Route path="products"   element={protectedPage('products', <ProductsPage />)} />
                    <Route path="sales"      element={protectedPage('sales', <SalesPage />)} />
                    <Route path="pos"        element={protectedPage('pos', <POSPage />)} />
                    <Route path="purchases"  element={protectedPage('purchases', <PurchasesPage />)} />
                    <Route path="expenses"   element={protectedPage('expenses', <ExpensesPage />)} />
                    <Route path="printer"    element={protectedPage('printer', <PrinterPage />)} />
                    <Route path="stock"      element={protectedPage('stock', <StockPage />)} />
                    <Route path="reports"    element={protectedPage('reports', <ReportsPage />)} />
                    <Route path="suppliers"  element={protectedPage('suppliers', <SuppliersPage />)} />
                    <Route path="cash"       element={protectedPage('cash', <CashPage />)} />
                    <Route path="security"   element={protectedPage('security', <SecurityCenterPage />)} />
                    <Route path="users"      element={protectedPage('users', <UsersPage />)} />
                    <Route path="settings"   element={protectedPage('settings', <SettingsPage />)} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ConfirmProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: { background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' },
              success: { iconTheme: { primary: '#22c55e', secondary: 'var(--bg2)' } },
              error:   { iconTheme: { primary: '#ef4444', secondary: 'var(--bg2)' } },
            }}
          />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
