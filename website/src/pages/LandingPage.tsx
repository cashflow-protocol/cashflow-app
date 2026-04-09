import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import WaitlistModal from '../components/WaitlistModal';
import '../styles/landing.css';

export default function LandingPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active');
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Navbar scroll effect
  useEffect(() => {
    const handler = () => {
      document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <>
      {/* Navbar */}
      <nav id="navbar">
        <div className="nav-inner">
          <a href="#" className="nav-logo">
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>cashflow</span>
            <span style={{ color: '#565656', fontFamily: "'Poppins', sans-serif", fontWeight: 300 }}>| Wealth Manager</span>
          </a>
          <div className="nav-links">
            <a href="#earn">Earn</a>
            <a href="#portfolio">Portfolio</a>
            <a href="#screenshots">App</a>
            <a href="https://x.com/cashflow_fi" target="_blank" rel="noopener">Twitter</a>
            <a href="https://t.me/founders_journey" target="_blank" rel="noopener">Telegram</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-content reveal">
          <div className="hero-badge">Live on Solana</div>
          <h1>Rething<br /><span className="gradient-text">yield generation.</span></h1>
          <p>Earn yield across top Solana protocols.<br />One mobile app for everything.</p>
          <div className="hero-buttons">
            <button className="btn btn-l btn-gradient" onClick={() => setWaitlistOpen(true)}>Join Waitlist</button>
            <a href="#earn" className="btn btn-l btn-outline">How it works</a>
          </div>
        </div>
        <div className="hero-phone reveal">
          <div className="hero-phone-group">
            <div className="phone phone-left"><img src="/assets/Assets.png" alt="Assets screen" /></div>
            <div className="phone phone-center"><img src="/assets/Main.png" alt="Cashflow home screen" /></div>
            <div className="phone phone-right"><img src="/assets/Earn.png" alt="Earn screen" /></div>
          </div>
        </div>
      </section>

      {/* Earn Section */}
      <div className="section" id="earn">
        <div className="card-section card-light reveal">
          <div className="card-layout">
            <div className="card-text">
              <h2>Earn yield without the hassle</h2>
              <p>Compare APYs across multiple lending protocols and deposit in a few taps. Your weighted average APY is calculated automatically.</p>
              <div className="tag-list">
                <span className="tag">Jupiter Lend</span>
                <span className="tag">Kamino</span>
                <span className="tag">Drift</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={() => setWaitlistOpen(true)}>Start earning</button>
            </div>
            <div className="card-phone">
              <div className="phone"><img src="/assets/Earn.png" alt="Earn screen" /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio Section */}
      <div className="section" id="portfolio">
        <div className="card-section card-green reveal">
          <div className="card-layout reverse">
            <div className="card-phone">
              <div className="phone"><img src="/assets/Main.png" alt="Portfolio dashboard" /></div>
            </div>
            <div className="card-text">
              <h2>Your whole portfolio at a glance</h2>
              <p>See your total balance across all assets and earn positions. Send, receive, and convert tokens instantly.</p>
              <div className="tag-list">
                <span className="tag">Portfolio tracking</span>
                <span className="tag">Send & Receive</span>
                <span className="tag">Token convert</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={() => setWaitlistOpen(true)}>Try it out</button>
            </div>
          </div>
        </div>
      </div>

      {/* Assets Section */}
      <div className="section">
        <div className="card-section card-dark reveal">
          <div className="card-layout">
            <div className="card-text">
              <h2>All your tokens. One place.</h2>
              <p>Track SOL and Stablecoin holdings with real-time USD values. Built natively for Solana Mobile.</p>
              <div className="tag-list">
                <span className="tag">Crypto</span>
                <span className="tag">Stablecoins</span>
                <span className="tag">Stocks</span>
                <span className="tag">Metals</span>
              </div>
              <button className="btn btn-m btn-gradient" onClick={() => setWaitlistOpen(true)}>Download</button>
            </div>
            <div className="card-phone">
              <div className="phone"><img src="/assets/Assets.png" alt="Assets screen" /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Features */}
      <div className="bento">
        <div className="bento-grid">
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-blue">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm14 3a3 3 0 11-6 0 3 3 0 016 0z" stroke="#347AC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Unified Dashboard</h3>
            <p>Assets + earn positions combined in one total balance view.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-green">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" stroke="#19C394" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Yield Comparison</h3>
            <p>Compare APY rates across protocols. Filter by token type.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-purple">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Squads Multi-Sig</h3>
            <p>Create shared wallets for team treasuries and multi-sig management.</p>
          </div>
        </div>
      </div>

      {/* Screenshots */}
      <section className="screenshots" id="screenshots">
        <h2 className="reveal">See it in action</h2>
        <p className="reveal">Every screen designed for simplicity.</p>
        <div className="screenshots-track reveal">
          <div className="screenshot-item"><img src="/assets/Main.png" alt="Home" /></div>
          <div className="screenshot-item"><img src="/assets/Earn.png" alt="Earn" /></div>
          <div className="screenshot-item"><img src="/assets/Assets.png" alt="Assets" /></div>
          <div className="screenshot-item"><img src="/assets/Deposit.png" alt="Deposit" /></div>
          <div className="screenshot-item"><img src="/assets/Receive.png" alt="Receive" /></div>
        </div>
      </section>

      {/* Protocols */}
      <div className="protocols">
        <div className="protocols-card reveal">
          <h2>Integrated Protocols</h2>
          <p>Access the best of Solana DeFi from one interface.</p>
          <div className="protocol-grid">
            <div className="protocol-pill">Jupiter Lend</div>
            <div className="protocol-pill">Kamino</div>
            <div className="protocol-pill">Drift</div>
            <div className="protocol-pill">Squads</div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="cta" id="cta">
        <div className="cta-card reveal">
          <h2>Start earning on Solana</h2>
          <p>Put your assets to work across the best DeFi protocols.</p>
          <div className="cta-buttons">
            <button className="btn btn-l btn-white" onClick={() => setWaitlistOpen(true)}>Join Waitlist</button>
            <a href="https://x.com/cashflow_fi" target="_blank" rel="noopener" className="btn btn-l btn-outline">Follow for Updates</a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer>
        <div className="footer-inner">
          <div className="footer-left">
            <img src="/assets/logo-512.png" alt="Cashflow" />
            <span>&copy; 2026 Cashflow</span>
          </div>
          <div className="footer-links">
            <a href="https://x.com/cashflow_fi" target="_blank" rel="noopener">Twitter</a>
            <a href="https://t.me/founders_journey" target="_blank" rel="noopener">Telegram</a>
            <Link to="/licence">Licence</Link>
            <Link to="/copyright">Copyright</Link>
            <Link to="/privacy-policy">Privacy Policy</Link>
          </div>
        </div>
      </footer>

      <WaitlistModal open={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
    </>
  );
}
