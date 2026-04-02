import { useEffect } from 'react';
import { Link } from 'react-router';
import '../styles/download.css';

export default function DownloadPage() {
  useEffect(() => {
    document.title = 'Download — Cashflow';
  }, []);

  return (
    <div className="download-page">
      <div className="download-container">
        <Link to="/" className="download-back">← Back to cashflow.fun</Link>

        <div className="download-hero">
          <h1>
            Get <span className="gradient-text">Cashflow</span>
          </h1>
          <p className="download-subtitle">
            The easiest way to earn yield on Solana. Download for your platform.
          </p>
        </div>

        <div className="download-cards">
          <a
            href="https://store.solanamobile.com/products/cashflow"
            target="_blank"
            rel="noopener noreferrer"
            className="download-card active"
          >
            <div className="download-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="1" width="14" height="22" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="19" r="1" fill="currentColor" />
                <line x1="9" y1="4" x2="15" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <h2>Solana dApp Store</h2>
            <p>Available now on Solana Mobile</p>
            <span className="download-badge available">Download</span>
          </a>

          <div className="download-card disabled">
            <div className="download-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 16.56 2.94 11.3 4.7 7.72C5.57 5.96 7.36 4.86 9.28 4.84C10.56 4.81 11.78 5.7 12.56 5.7C13.34 5.7 14.85 4.63 16.41 4.8C17.07 4.83 18.91 5.07 20.08 6.79C19.97 6.85 17.76 8.16 17.79 10.83C17.82 14.01 20.56 15.07 20.59 15.08C20.56 15.16 20.13 16.62 19.08 18.12L18.71 19.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M15.5 2C15.5 3.5 14.78 4.88 13.73 5.78C12.73 6.65 11.34 7.22 10 7.1C9.95 5.65 10.68 4.26 11.69 3.37C12.78 2.42 14.28 1.82 15.5 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </div>
            <h2>App Store</h2>
            <p>For iPhone and iPad</p>
            <span className="download-badge coming-soon">Coming Soon</span>
          </div>

          <div className="download-card disabled">
            <div className="download-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path d="M17.523 2.235L15.39 5.59C16.86 6.44 17.95 7.82 18.38 9.47H5.62C6.05 7.82 7.14 6.44 8.61 5.59L6.477 2.235" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="4" y="9.5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="9" cy="7" r="0.75" fill="currentColor" />
                <circle cx="15" cy="7" r="0.75" fill="currentColor" />
              </svg>
            </div>
            <h2>Google Play</h2>
            <p>For Android devices</p>
            <span className="download-badge coming-soon">Coming Soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}
