import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router';
import WaitlistModal from '../components/WaitlistModal';
import '../styles/landing.css';

// Render a string as <span class="letter" style={{'--li': i}}>char</span> for staggered entrance.
function renderLetters(text: string) {
  return Array.from(text).map((ch, i) => (
    <span key={i} className="letter" style={{ ['--li' as string]: i } as React.CSSProperties}>
      {ch === ' ' ? '\u00A0' : ch}
    </span>
  ));
}

const TRUST_LOGOS = [
  { src: '/assets/protocols/jupiter.svg', alt: 'Jupiter' },
  { src: '/assets/protocols/kamino.svg', alt: 'Kamino' },
  { src: '/assets/protocols/drift.svg', alt: 'Drift' },
  { src: '/assets/protocols/solomon.svg', alt: 'Solomon' },
  { src: '/assets/protocols/perena.jpg', alt: 'Perena' },
  { src: '/assets/protocols/onre.jpg', alt: 'Onre' },
];

const STAT_TARGETS = [
  { id: 'protocols', target: 6, suffix: '+', label: 'DeFi protocols' },
  { id: 'custody', target: 100, suffix: '%', label: 'Self-custodial' },
  { id: 'tap', target: 1, suffix: '', label: 'Tap to deposit' },
];

export default function LandingPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [statValues, setStatValues] = useState<Record<string, number>>({ protocols: 0, custody: 0, tap: 0 });
  const heroRef = useRef<HTMLElement>(null);
  const heroContentRef = useRef<HTMLDivElement>(null);
  const magneticBtnRef = useRef<HTMLButtonElement>(null);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active');
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Navbar scroll blur
  useEffect(() => {
    const handler = () => {
      document.getElementById('navbar')?.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  // Hero parallax (mouse-driven --mx, --my for orbs/decorations/phones)
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = hero.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const my = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        hero.style.setProperty('--mx', mx.toFixed(3));
        hero.style.setProperty('--my', my.toFixed(3));
      });
    };
    const onLeave = () => {
      hero.style.setProperty('--mx', '0');
      hero.style.setProperty('--my', '0');
    };
    hero.addEventListener('mousemove', onMove);
    hero.addEventListener('mouseleave', onLeave);
    return () => {
      hero.removeEventListener('mousemove', onMove);
      hero.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 3D tilt on cards & bento
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('.section .card-section, .bento-card, .protocols-card, .cta-card');
    const cleanups: Array<() => void> = [];
    cards.forEach(card => {
      let raf = 0;
      const onMove = (e: MouseEvent) => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const mx = (e.clientX - rect.left) / rect.width - 0.5;
          const my = (e.clientY - rect.top) / rect.height - 0.5;
          card.style.setProperty('--tilt-x', `${(my * -3).toFixed(2)}deg`);
          card.style.setProperty('--tilt-y', `${(mx * 3).toFixed(2)}deg`);
        });
      };
      const onLeave = () => {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      };
      card.addEventListener('mousemove', onMove);
      card.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        card.removeEventListener('mousemove', onMove);
        card.removeEventListener('mouseleave', onLeave);
        cancelAnimationFrame(raf);
      });
    });
    return () => cleanups.forEach(c => c());
  }, []);

  // Animated number counters (fire when hero visible)
  useEffect(() => {
    const hero = heroContentRef.current;
    if (!hero) return;
    let started = false;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !started) {
          started = true;
          const start = performance.now();
          const duration = 1400;
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            setStatValues({
              protocols: Math.round(eased * STAT_TARGETS[0].target),
              custody: Math.round(eased * STAT_TARGETS[1].target),
              tap: Math.round(eased * STAT_TARGETS[2].target),
            });
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.4 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  // Magnetic primary button
  useEffect(() => {
    const btn = magneticBtnRef.current;
    if (!btn) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const radius = 110;
        if (dist < radius) {
          const pull = (1 - dist / radius) * 8;
          btn.style.setProperty('--mag-x', `${(dx / dist) * pull}px`);
          btn.style.setProperty('--mag-y', `${(dy / dist) * pull}px`);
        } else {
          btn.style.setProperty('--mag-x', '0px');
          btn.style.setProperty('--mag-y', '0px');
        }
      });
    };
    const onLeave = () => {
      btn.style.setProperty('--mag-x', '0px');
      btn.style.setProperty('--mag-y', '0px');
    };
    window.addEventListener('mousemove', onMove);
    btn.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      btn.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Confetti burst
  const burstConfetti = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const x = e.clientX;
    const y = e.clientY;
    const colors = ['#03fbff', '#19C394', '#347AC0', '#F6C453', '#ffffff'];
    const shapes = ['confetti-diamond', 'confetti-spark', 'confetti-dot'];
    const count = 14;
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      const shape = shapes[i % shapes.length];
      const color = colors[i % colors.length];
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const dist = 70 + Math.random() * 70;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const rot = (Math.random() - 0.5) * 720;
      el.className = `confetti-particle ${shape}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.color = color;
      el.style.setProperty('--dx', `${dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
      el.style.setProperty('--rot', `${rot}deg`);
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1100);
    }
  }, []);

  const openWaitlist = (e: React.MouseEvent<HTMLElement>) => {
    burstConfetti(e);
    setWaitlistOpen(true);
  };

  const fmt = (n: number, suffix: string) => `${n}${suffix}`;

  return (
    <>
      {/* Navbar */}
      <nav id="navbar">
        <div className="nav-inner">
          <a href="#" className="nav-logo">
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>cashflow</span>
            <span style={{ color: '#565656', fontFamily: "'Poppins', sans-serif", fontWeight: 300 }}>| Personal Finance</span>
          </a>
          <div className="nav-links">
            <a href="#earn">Earn</a>
            <a href="#passport">Passport</a>
            <a href="#family">Family</a>
            <a href="#security">Security</a>
            <a href="#protocols">Protocols</a>
            <a href="https://x.com/cashflow_fi" target="_blank" rel="noopener">Twitter</a>
          </div>
          <button className="btn btn-s btn-gradient nav-cta" onClick={openWaitlist}>Get the app</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero" ref={heroRef}>
        <div className="hero-bg" />
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-grid" />

        {/* Floating decorations */}
        <svg className="float-deco deco-spark deco-spark-1" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z" fill="currentColor" />
        </svg>
        <svg className="float-deco deco-diamond" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2l10 10-10 10L2 12 12 2z" fill="currentColor" />
        </svg>
        <svg className="float-deco deco-spark deco-spark-2" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z" fill="currentColor" />
        </svg>
        <svg className="float-deco deco-plus" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <svg className="float-deco deco-ring" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        </svg>

        <div className="hero-content reveal" ref={heroContentRef}>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Live on Solana &middot; Self-custodial
          </div>
          <h1>
            <span className="hero-line">{renderLetters('Your money,')}</span>
            <br />
            <span className="hero-underline-wrap">
              <span className="gradient-text">working for you.</span>
              <svg className="hero-underline" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="ulGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#347AC0" />
                    <stop offset="50%" stopColor="#19C394" />
                    <stop offset="100%" stopColor="#03fbff" />
                  </linearGradient>
                </defs>
                <path d="M2 7 Q 75 1, 150 6 T 298 7" stroke="url(#ulGrad)" strokeWidth="3" strokeLinecap="round" fill="none" />
              </svg>
            </span>
          </h1>
          <p>Personal Finance App on Solana. Earn yield, swap tokens, save with family, and own your identity onchain — all in one app.</p>
          <div className="hero-buttons">
            <button ref={magneticBtnRef} className="btn btn-l btn-gradient btn-magnetic btn-breathe" onClick={openWaitlist}>Join Waitlist</button>
            <a href="#earn" className="btn btn-l btn-outline">Explore features</a>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <div className="hero-stat-num">{fmt(statValues.protocols, STAT_TARGETS[0].suffix)}</div>
              <div className="hero-stat-label">{STAT_TARGETS[0].label}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-num">{fmt(statValues.custody, STAT_TARGETS[1].suffix)}</div>
              <div className="hero-stat-label">{STAT_TARGETS[1].label}</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-num">{fmt(statValues.tap, STAT_TARGETS[2].suffix)}</div>
              <div className="hero-stat-label">{STAT_TARGETS[2].label}</div>
            </div>
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

      {/* Trusted-by strip */}
      <div className="trust-strip reveal">
        <div className="trust-strip-inner">
          <span className="trust-strip-label">Powered by the best of Solana DeFi</span>
          <div className="trust-strip-marquee">
            <div className="trust-strip-track">
              {[...TRUST_LOGOS, ...TRUST_LOGOS].map((logo, i) => (
                <img key={i} src={logo.src} alt={logo.alt} aria-hidden={i >= TRUST_LOGOS.length} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Earn Section */}
      <div className="section" id="earn">
        <div className="card-section card-light reveal">
          <div className="card-pill">Earn</div>
          <div className="card-layout">
            <div className="card-text">
              <h2>The best yields on Solana, in one place</h2>
              <p>Compare APYs across top lending protocols and stable yield vaults. Deposit in a few taps. Your weighted average APY is calculated automatically.</p>
              <div className="tag-list">
                <span className="tag">Jupiter Lend</span>
                <span className="tag">Kamino</span>
                <span className="tag">Drift</span>
                <span className="tag">Solomon (sUSDv)</span>
                <span className="tag">Perena</span>
                <span className="tag">Onre</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={openWaitlist}>Start earning</button>
            </div>
            <div className="card-phone">
              <div className="phone"><img src="/assets/Earn.png" alt="Earn screen" /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Section divider deco */}
      <div className="deco-divider" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z" fill="currentColor" />
        </svg>
      </div>

      {/* Cashflow Passport */}
      <div className="section" id="passport">
        <div className="card-section card-passport reveal">
          <div className="passport-glow" />
          <div className="card-layout reverse">
            <div className="passport-visual">
              <img src="/assets/passport.png" alt="Cashflow Passport" className="passport-image" />
              <div className="passport-orbit passport-orbit-1" />
              <div className="passport-orbit passport-orbit-2" />
            </div>
            <div className="card-text">
              <div className="card-pill card-pill-light">New &middot; Onchain identity</div>
              <h2>Cashflow Passport &amp; Reward Badges</h2>
              <p>Mint your Cashflow Passport once and collect onchain badges as you use the app. Every milestone — your first deposit, first swap, first transfer — becomes a verifiable NFT in your Passport.</p>
              <div className="badge-row">
                <div className="badge-chip">Seeker Pioneer</div>
                <div className="badge-chip">Jupiter Lender</div>
                <div className="badge-chip">Kamino Lender</div>
                <div className="badge-chip">Swapper</div>
                <div className="badge-chip">First Payment</div>
              </div>
              <button className="btn btn-m btn-white" onClick={openWaitlist}>Activate Passport</button>
            </div>
          </div>
        </div>
      </div>

      {/* Portfolio Section */}
      <div className="section" id="portfolio">
        <div className="card-section card-green reveal">
          <div className="card-pill">Portfolio</div>
          <div className="card-layout reverse">
            <div className="card-phone">
              <div className="phone"><img src="/assets/Main.png" alt="Portfolio dashboard" /></div>
            </div>
            <div className="card-text">
              <h2>Your whole portfolio at a glance</h2>
              <p>Total balance across assets and earn positions, calculated in real time. Pull-to-refresh, live token values, and instant convert — designed for speed.</p>
              <div className="tag-list">
                <span className="tag">Live balances</span>
                <span className="tag">Cost basis</span>
                <span className="tag">Token convert</span>
                <span className="tag">7d performance</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={openWaitlist}>Try it out</button>
            </div>
          </div>
        </div>
      </div>

      {/* Section divider deco */}
      <div className="deco-divider deco-divider-alt" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M12 2l10 10-10 10L2 12 12 2z" fill="currentColor" />
        </svg>
      </div>

      {/* Swap Section */}
      <div className="section" id="swap">
        <div className="card-section card-dark reveal">
          <div className="card-pill card-pill-dark">Swap</div>
          <div className="card-layout">
            <div className="card-text">
              <h2>Best-route swaps, powered by Jupiter</h2>
              <p>Swap any token to any token at the best price on Solana. Real-time balances, dynamic Jito tips, and a clean confirmation flow that won't surprise you on fees.</p>
              <div className="tag-list">
                <span className="tag">Jupiter routing</span>
                <span className="tag">Live quotes</span>
                <span className="tag">Best price</span>
                <span className="tag">Low fees</span>
              </div>
              <button className="btn btn-m btn-gradient" onClick={openWaitlist}>Get the app</button>
            </div>
            <div className="card-phone">
              <div className="phone"><img src="/assets/Assets.png" alt="Swap & assets" /></div>
            </div>
          </div>
        </div>
      </div>

      {/* Family Savings */}
      <div className="section" id="family">
        <div className="card-section card-family reveal">
          <div className="card-layout">
            <div className="card-text">
              <div className="card-pill card-pill-light">Family</div>
              <h2>Save together. Reach goals faster.</h2>
              <p>A new home, a family trip, an emergency fund. Create shared savings goals with your partner or family — track contributions, watch progress, and earn yield while you save.</p>
              <div className="tag-list">
                <span className="tag">Shared goals</span>
                <span className="tag">Joint vault</span>
                <span className="tag">Auto-yield</span>
              </div>
              <Link to="/family" className="btn btn-m btn-white">Learn more</Link>
            </div>
            <div className="card-phone family-photo">
              <img src="/assets/family/family.png" alt="Family savings" />
            </div>
          </div>
        </div>
      </div>

      {/* Security: Spending Limits + Recovery + Squads */}
      <div className="bento" id="security">
        <div className="bento-header reveal">
          <div className="card-pill card-pill-dark">Security</div>
          <h2>Self-custody, made safe.</h2>
          <p>Your keys, your funds. Plus the guardrails you'd expect from a real bank.</p>
        </div>
        <div className="bento-grid">
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-blue">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#347AC0" strokeWidth="2" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" stroke="#347AC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Spending Limits</h3>
            <p>Cap how much can leave your wallet per transaction. Protects you from device theft, malicious dApps, and fat fingers.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-green">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0z" stroke="#19C394" strokeWidth="2" /><path d="M21 3v6h-6M3 21v-6h6" stroke="#19C394" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Vote-only Recovery</h3>
            <p>Lose your phone? Recover access through trusted recovery signers — without ever giving them control of your funds.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-purple">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Squads Multi-Sig</h3>
            <p>Built on Squads. Create shared treasuries with multi-sig approvals — perfect for teams, DAOs, and family vaults.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-amber">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" stroke="#F59E0B" strokeWidth="2" /><path d="M7 11V7a5 5 0 0110 0v4" stroke="#F59E0B" strokeWidth="2" /></svg>
            </div>
            <h3>PIN &amp; Biometrics</h3>
            <p>Every sensitive action is gated by your PIN and Face ID. Keys are stored in the device secure enclave.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-cyan">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.56.93 6.18 2.45" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" /><path d="M21 4v5h-5" stroke="#06B6D4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>SNS &amp; ANS Domains</h3>
            <p>Send to <em>mike.sol</em> instead of long addresses. Resolve both Solana Name Service and Allbridge Name Service.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-pink">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 2l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1 3-6z" stroke="#EC4899" strokeWidth="2" strokeLinejoin="round" /></svg>
            </div>
            <h3>Reward Badges</h3>
            <p>Earn collectible NFT badges as you use Cashflow. Stored in your Cashflow Passport — verifiable forever.</p>
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
      <div className="protocols" id="protocols">
        <div className="protocols-card reveal">
          <h2>Built on Solana&apos;s best</h2>
          <p>Battle-tested DeFi, accessible from one mobile app.</p>
          <div className="protocol-grid">
            <div className="protocol-tile">
              <img src="/assets/protocols/jupiter.svg" alt="Jupiter" />
              <span>Jupiter</span>
            </div>
            <div className="protocol-tile">
              <img src="/assets/protocols/kamino.svg" alt="Kamino" />
              <span>Kamino</span>
            </div>
            <div className="protocol-tile">
              <img src="/assets/protocols/drift.svg" alt="Drift" />
              <span>Drift</span>
            </div>
            <div className="protocol-tile">
              <img src="/assets/protocols/solomon.svg" alt="Solomon" />
              <span>Solomon</span>
            </div>
            <div className="protocol-tile">
              <img src="/assets/protocols/perena.jpg" alt="Perena" />
              <span>Perena</span>
            </div>
            <div className="protocol-tile">
              <img src="/assets/protocols/onre.jpg" alt="Onre" />
              <span>Onre</span>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="cta" id="cta">
        <div className="cta-card reveal">
          <h2>Start earning on Solana</h2>
          <p>Join the waitlist. Get early access. Put your assets to work.</p>
          <div className="cta-buttons">
            <button className="btn btn-l btn-white btn-breathe" onClick={openWaitlist}>Join Waitlist</button>
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
            <Link to="/family">Family</Link>
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
