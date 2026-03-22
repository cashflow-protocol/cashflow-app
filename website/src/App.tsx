import { Routes, Route } from 'react-router';
import { AppProvider, getDefaultConfig } from '@solana/connector/react';
import LandingPage from './pages/LandingPage';
import RecoveryPage from './pages/RecoveryPage';

const connectorConfig = getDefaultConfig({
  appName: 'Cashflow',
});

export default function App() {
  return (
    <AppProvider connectorConfig={connectorConfig}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/recovery/:id" element={<RecoveryPage />} />
      </Routes>
    </AppProvider>
  );
}
