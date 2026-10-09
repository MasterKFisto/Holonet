import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AdminPage } from './pages/AdminPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { SiteDetailPage } from './pages/SiteDetailPage';
import { SiteFormsPage } from './pages/SiteFormsPage';
import { SiteImportPage } from './pages/SiteImportPage';
import { SitePageDetailPage } from './pages/SitePageDetailPage';
import { SitePagesPage } from './pages/SitePagesPage';
import { SitePublishPage } from './pages/SitePublishPage';
import { SitesPage } from './pages/SitesPage';
import { SiteThemePage } from './pages/SiteThemePage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/sites/:siteId" element={<SiteDetailPage />} />
        <Route path="/sites/:siteId/pages" element={<SitePagesPage />} />
        <Route path="/sites/:siteId/pages/:pageId" element={<SitePageDetailPage />} />
        <Route path="/sites/:siteId/theme" element={<SiteThemePage />} />
        <Route path="/sites/:siteId/publish" element={<SitePublishPage />} />
        <Route path="/sites/:siteId/forms" element={<SiteFormsPage />} />
        <Route path="/sites/:siteId/import" element={<SiteImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
