import { Routes, Route } from 'react-router';
import { AppProvider, getDefaultConfig } from '@solana/connector/react';
import { PrivyProvider } from '@privy-io/react-auth';
import LandingPage from './pages/LandingPage';
import RecoveryPage from './pages/RecoveryPage';
import DownloadPage from './pages/DownloadPage';
import LicencePage from './pages/LicencePage';
import CopyrightPage from './pages/CopyrightPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';

const connectorConfig = getDefaultConfig({
  appName: 'Cashflow',
});

const PRIVY_APP_ID = 'cmmz2xt0y00170ci6dxwc9cst';

export default function App() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        embeddedWallets: {
          solana: { createOnLogin: 'all-users' },
        },
      }}
    >
      <AppProvider connectorConfig={connectorConfig}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/recovery/:id" element={<RecoveryPage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/licence" element={<LicencePage />} />
          <Route path="/copyright" element={<CopyrightPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        </Routes>
      </AppProvider>
    </PrivyProvider>
  );
}
