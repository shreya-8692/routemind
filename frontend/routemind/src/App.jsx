import { BrowserRouter, Link, Route, Routes } from 'react-router';
import SettingsProvider from './context/SettingsProvider';
import LocationProvider from './context/LocationProvider';
import EmergencyProvider from './context/EmergencyProvider';
import AppHeader from './components/layout/AppHeader';
import ErrorBoundary from './components/common/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import EmergencyPage from './pages/EmergencyPage';
import MapPage from './pages/MapPage';
import RoutePage from './pages/RoutePage';
import DashboardPage from './pages/DashboardPage';
import HistoryPage from './pages/HistoryPage';
import SettingsPage from './pages/SettingsPage';

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <Link to="/">Back to RouteMind</Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SettingsProvider>
        <LocationProvider>
          <EmergencyProvider>
            <div className="app">
              <AppHeader />
              <main className="app-main">
                <ErrorBoundary>
                  <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/emergency" element={<EmergencyPage />} />
                    <Route path="/map" element={<MapPage />} />
                    <Route path="/route" element={<RoutePage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </ErrorBoundary>
              </main>
            </div>
          </EmergencyProvider>
        </LocationProvider>
      </SettingsProvider>
    </BrowserRouter>
  );
}
