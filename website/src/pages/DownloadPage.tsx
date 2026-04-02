import { useEffect } from 'react';
import '../styles/download.css';

export default function DownloadPage() {
  useEffect(() => {
    document.title = 'Download — Cashflow';
  }, []);

  return (
    <div className="download-page">
      <div className="download-container">
        <div className="download-hero">
          <h1>
            Get <span className="gradient-text">Cashflow</span>
          </h1>
          <p className="download-subtitle">
            The easiest way to earn yield on Solana. Download for your platform.
          </p>
        </div>

        <div className="download-badges">
          <a
            href="https://store.solanamobile.com/products/cashflow"
            target="_blank"
            rel="noopener noreferrer"
            className="store-link"
          >
            <img
              src="/assets/badges/dapp-store.svg"
              alt="Get it on Solana dApp Store"
              className="store-badge"
            />
          </a>
        </div>
      </div>
    </div>
  );
}
