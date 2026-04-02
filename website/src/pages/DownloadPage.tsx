import { useEffect } from 'react';
import { Link } from 'react-router';
import '../styles/download.css';

function AppStoreBadge() {
  return (
    <svg viewBox="0 0 120 40" className="store-badge" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="40" rx="6" fill="#000" stroke="#a6a6a6" strokeWidth="0.6" />
      <g fill="#fff">
        <path d="M24.769 20.3a4.949 4.949 0 0 1 2.356-4.151 5.066 5.066 0 0 0-3.99-2.158c-1.68-.176-3.308 1.005-4.164 1.005-.872 0-2.19-.988-3.608-.958a5.315 5.315 0 0 0-4.473 2.728c-1.934 3.348-.491 8.269 1.361 10.976.927 1.325 2.01 2.805 3.428 2.753 1.387-.058 1.905-.885 3.58-.885 1.658 0 2.144.885 3.591.852 1.489-.025 2.426-1.332 3.32-2.669a10.962 10.962 0 0 0 1.52-3.092 4.782 4.782 0 0 1-2.92-4.4zM22.037 12.21a4.872 4.872 0 0 0 1.115-3.49 4.957 4.957 0 0 0-3.208 1.66 4.636 4.636 0 0 0-1.144 3.36 4.1 4.1 0 0 0 3.237-1.53z" />
        <text x="36.5" y="15" fontSize="5" fontFamily="'Poppins', sans-serif" fontWeight="400">Download on the</text>
        <text x="36.5" y="27" fontSize="11" fontFamily="'Poppins', sans-serif" fontWeight="600">App Store</text>
      </g>
    </svg>
  );
}

function GooglePlayBadge() {
  return (
    <svg viewBox="0 0 135 40" className="store-badge" xmlns="http://www.w3.org/2000/svg">
      <rect width="135" height="40" rx="6" fill="#000" stroke="#a6a6a6" strokeWidth="0.6" />
      <g transform="translate(10, 7.5)">
        <path d="M1.1 0.5L13.5 12.5L1.1 24.5C0.7 24.1 0.5 23.5 0.5 22.8V2.2C0.5 1.5 0.7 0.9 1.1 0.5Z" fill="#4285F4" />
        <path d="M17.8 8.8L14.4 11.6L13.5 12.5L14.4 13.4L17.8 16.2L18.3 16.5L22.4 14.2C23.6 13.5 23.6 11.5 22.4 10.8L18.3 8.5L17.8 8.8Z" fill="#FBBC04" />
        <path d="M14.4 13.4L13.5 12.5L1.1 24.5C1.7 25.1 2.6 25.2 3.6 24.6L18.3 16.5L14.4 13.4Z" fill="#EA4335" />
        <path d="M1.1 0.5C1.7 -0.1 2.6 -0.2 3.6 0.4L18.3 8.5L14.4 11.6L13.5 12.5L1.1 0.5Z" fill="#34A853" />
      </g>
      <g fill="#fff">
        <text x="38" y="13" fontSize="4.5" fontFamily="'Poppins', sans-serif" fontWeight="400" letterSpacing="0.5">GET IT ON</text>
        <text x="38" y="27" fontSize="10.5" fontFamily="'Poppins', sans-serif" fontWeight="500">Google Play</text>
      </g>
    </svg>
  );
}

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

          <div className="store-link disabled">
            <div className="store-badge-wrapper coming-soon">
              <AppStoreBadge />
              <span className="badge-overlay">Coming Soon</span>
            </div>
          </div>

          <div className="store-link disabled">
            <div className="store-badge-wrapper coming-soon">
              <GooglePlayBadge />
              <span className="badge-overlay">Coming Soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
