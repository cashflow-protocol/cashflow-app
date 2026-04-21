import { useState, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, CSSProperties, ComponentType } from 'react';
import { Link } from 'react-router';
import { CarFront, Plane, House, ShieldCheck } from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import WaitlistModal from '../components/WaitlistModal';
import '../styles/landing.css';
import '../styles/family.css';

const GOALS: { Icon: ComponentType<LucideProps>; name: string; current: string; target: string; pct: number }[] = [
  { Icon: CarFront,    name: 'New car',        current: '$18,400', target: '$25,000',  pct: 74 },
  { Icon: Plane,       name: 'Japan trip',     current: '$3,200',  target: '$8,000',   pct: 40 },
  { Icon: House,       name: 'New home',       current: '$42,100', target: '$150,000', pct: 28 },
  { Icon: ShieldCheck, name: 'Emergency fund', current: '$9,500',  target: '$10,000',  pct: 95 },
];

export default function FamilySavingsPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = 'Family Savings - Cashflow';
    window.scrollTo(0, 0);
  }, []);

  // Scroll reveal
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('active');
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.family-page .reveal').forEach(el => observer.observe(el));
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

  // Mouse parallax in hero
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

  // 3D tilt on card sections
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('.family-page .card-section, .family-page .bento-card');
    const handlers = new Map<HTMLElement, { onMove: (e: Event) => void; onLeave: () => void }>();
    cards.forEach(card => {
      const onMove = (e: Event) => {
        const me = e as unknown as MouseEvent;
        const rect = card.getBoundingClientRect();
        const mx = (me.clientX - rect.left) / rect.width - 0.5;
        const my = (me.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--tilt-x', `${(my * -3).toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${(mx * 3).toFixed(2)}deg`);
      };
      const onLeave = () => {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      };
      card.addEventListener('mousemove', onMove);
      card.addEventListener('mouseleave', onLeave);
      handlers.set(card, { onMove, onLeave });
    });
    return () => {
      handlers.forEach(({ onMove, onLeave }, card) => {
        card.removeEventListener('mousemove', onMove);
        card.removeEventListener('mouseleave', onLeave);
      });
    };
  }, []);

  // Confetti burst near the cursor on CTA click
  const fireConfetti = (x: number, y: number) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shapes: Array<'heart' | 'star' | 'dot'> = ['heart', 'star', 'dot', 'heart', 'star', 'dot', 'heart', 'star', 'dot', 'heart', 'star', 'dot'];
    const colors = ['#C97B5C', '#D9A048', '#9CAF88', '#E09B7D', '#B5793A'];
    shapes.forEach((shape, i) => {
      const el = document.createElement('span');
      el.className = `confetti-particle confetti-${shape}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.color = colors[i % colors.length];
      const angle = (i / shapes.length) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 70 + Math.random() * 60;
      el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      el.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1100);
    });
  };

  const openWaitlist = (e?: ReactMouseEvent) => {
    if (e) fireConfetti(e.clientX, e.clientY);
    setWaitlistOpen(true);
  };

  const renderLetters = (text: string, delayStart = 0) =>
    text.split('').map((c, i) => (
      <span
        key={i}
        className="letter"
        style={{ animationDelay: `${delayStart + i * 0.035}s` }}
      >
        {c === ' ' ? '\u00A0' : c}
      </span>
    ));

  return (
    <div className="family-page">
      {/* Navbar */}
      <nav id="navbar">
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>cashflow</span>
            <span className="nav-logo-sub" style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 300 }}>| Family Savings</span>
          </Link>
          <button className="btn btn-m btn-gradient" onClick={openWaitlist}>Join Waitlist</button>
        </div>
      </nav>

      {/* Hero */}
      <section className="family-hero" ref={heroRef}>
        <div className="family-hero-bg">
          <svg className="float-deco deco-heart" width="44" height="40" viewBox="0 0 44 40" fill="none" aria-hidden="true">
            <path d="M22 36S4 26 4 14a9 9 0 0118-3 9 9 0 0118 3c0 12-18 22-18 22z" fill="#D17A5C" stroke="#A85A3E" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <svg className="float-deco deco-star" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M20 4l4.8 10.2L36 16l-8 7.8L29.6 35 20 29.4 10.4 35 12 23.8 4 16l11.2-1.8L20 4z" fill="#9CAF88" stroke="#5E7450" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="family-hero-inner">
          <div className="family-hero-text reveal">
            <div className="family-hero-badge">Coming soon — join the family</div>
            <h1>
              <span className="line">{renderLetters('Save together.', 0.1)}</span>
              <br />
              <span className="hero-squiggle-wrap">
                <span className="gradient-text line">{renderLetters('Earn together.', 0.6)}</span>
                <svg className="squiggle hero-squiggle" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true">
                  <path
                    d="M2 9 Q 30 1 60 7 T 120 7 T 180 7 T 238 6"
                    fill="none"
                    stroke="#C97B5C"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p>One app for your family's joint vault, kids' savings, and every big dream in between. Your money earns yield automatically — while you plan life.</p>
            <div className="family-hero-buttons">
              <button className="btn btn-l btn-gradient" onClick={openWaitlist}>Join Waitlist</button>
              <a href="#dreams" className="btn btn-l btn-dark">How it works</a>
            </div>
          </div>
          <div className="family-hero-image reveal">
            <div className="hero-polaroid">
              <span className="hero-polaroid-tape" aria-hidden="true" />
              <img src="/assets/family/family1.png" alt="A family standing together, ready to save for what matters" />
              <span className="hero-polaroid-caption">our family · saving forward</span>
            </div>
          </div>
        </div>
      </section>

      {/* Between-section drifter 1 */}
      <svg className="float-deco deco-between deco-between-1" width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path d="M20 4l4.8 10.2L36 16l-8 7.8L29.6 35 20 29.4 10.4 35 12 23.8 4 16l11.2-1.8L20 4z" fill="#D9A048" stroke="#B5793A" strokeWidth="2" strokeLinejoin="round" />
      </svg>

      {/* Dreams / goal vaults */}
      <div className="section" id="dreams">
        <div className="card-section card-warm reveal">
          <div className="card-layout">
            <div className="card-text">
              <h2>A vault for every big dream</h2>
              <p>Name the goal. Watch it grow. Each dream gets its own vault with real-time progress — and it's earning yield the whole time.</p>

              <div className="family-goals reveal">
                {GOALS.map((g, i) => (
                  <div
                    key={g.name}
                    className="family-goal"
                    style={{ '--goal-delay': `${i * 0.15}s`, '--goal-pct': `${g.pct}%` } as CSSProperties}
                  >
                    <div className="family-goal-head">
                      <span className="family-goal-label">
                        <g.Icon size={20} strokeWidth={1.8} color="#A85A3E" />
                        {g.name}
                      </span>
                      <span className="family-goal-amount">{g.current} <span className="family-goal-target">/ {g.target}</span></span>
                    </div>
                    <div className="family-goal-bar">
                      <div className="family-goal-fill" />
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn btn-m btn-dark" onClick={openWaitlist}>See how it works</button>
            </div>
            <div className="family-card-image">
              <img src="/assets/family/family-with-new-car.png" alt="A family celebrating buying a new car together" />
            </div>
          </div>
        </div>
      </div>

      {/* Between-section drifter 2 */}
      <svg className="float-deco deco-between deco-between-2" width="42" height="38" viewBox="0 0 44 40" fill="none" aria-hidden="true">
        <path d="M22 36S4 26 4 14a9 9 0 0118-3 9 9 0 0118 3c0 12-18 22-18 22z" fill="#E09B7D" stroke="#A85A3E" strokeWidth="2" strokeLinejoin="round" />
      </svg>

      {/* Kids' savings */}
      <div className="section">
        <div className="card-section card-sage reveal">
          <div className="card-layout reverse">
            <div className="family-card-image">
              <img src="/assets/family/family3.png" alt="Parents lifting their child in a moment of joy" />
            </div>
            <div className="card-text">
              <h2>Teach them to save</h2>
              <p>Give every kid their own savings vault. You stay in control — deposits, allowances, spending limits — while they watch their balance grow and learn how money works.</p>
              <div className="tag-list">
                <span className="tag">Kid-safe controls</span>
                <span className="tag">Allowance deposits</span>
                <span className="tag">Earning interest</span>
                <span className="tag">Parental approval</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={openWaitlist}>Join Waitlist</button>
            </div>
          </div>
        </div>
      </div>

      {/* Between-section drifter 3 */}
      <svg className="float-deco deco-between deco-between-3" width="46" height="42" viewBox="0 0 48 44" fill="none" aria-hidden="true">
        <path d="M6 22L24 6l18 16v18a2 2 0 01-2 2H8a2 2 0 01-2-2V22z" fill="#D5E2C6" stroke="#5E7450" strokeWidth="2" strokeLinejoin="round" />
        <path d="M19 42V28h10v14" stroke="#5E7450" strokeWidth="2" strokeLinejoin="round" />
      </svg>

      {/* Joint vault */}
      <div className="section">
        <div className="card-section card-peach reveal">
          <div className="card-layout">
            <div className="card-text">
              <h2>One family, one place</h2>
              <p>The joint family vault for shared expenses, plus private pockets for each parent. Everything deposits into Solana yield protocols automatically — your money never sits idle.</p>
              <div className="tag-list">
                <span className="tag">Joint vault</span>
                <span className="tag">Mom's vault</span>
                <span className="tag">Dad's vault</span>
                <span className="tag">Auto-yield</span>
              </div>
              <button className="btn btn-m btn-dark" onClick={openWaitlist}>Join Waitlist</button>
            </div>
            <div className="family-card-image">
              <img src="/assets/family/family2.png" alt="A couple at home with a memory board of their life together" />
            </div>
          </div>
        </div>
      </div>

      {/* Bento */}
      <div className="bento">
        <div className="bento-grid">
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-sage">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" stroke="#5E7450" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Automatic yield</h3>
            <p>Every dollar earns while it waits for the trip, the car, the house.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-terracotta">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 2a5 5 0 015 5v3H7V7a5 5 0 015-5zm-7 8h14a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V11a1 1 0 011-1zm7 4a2 2 0 100 4 2 2 0 000-4z" stroke="#A85A3E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Kid-safe</h3>
            <p>Parents stay in control. Kids learn by watching their savings grow.</p>
          </div>
          <div className="bento-card reveal">
            <div className="bento-icon bento-icon-amber">
              <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><path d="M12 2L15 8.5 22 9.5 17 14.5 18.5 21.5 12 18 5.5 21.5 7 14.5 2 9.5 9 8.5 12 2z" stroke="#B5793A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h3>Real goals, real progress</h3>
            <p>Name it, fund it, track it. No spreadsheets, no guessing.</p>
          </div>
        </div>
      </div>

      {/* Lifestyle */}
      <section className="family-lifestyle">
        <div className="family-lifestyle-card reveal">
          <img src="/assets/family/family-with-new-home.png" alt="A family in front of their new home" />
          <h2>Big moments, funded.</h2>
          <p>This is what saving together looks like.</p>
        </div>
      </section>

      {/* CTA — scrapbook finale */}
      <div className="cta">
        <div className="family-finale reveal">
          <span className="washi washi-tl" aria-hidden="true" />
          <span className="washi washi-br" aria-hidden="true" />

          <div className="finale-inner">
            <div className="finale-text">
              <h2>
                Start a{' '}
                <span className="underline-squiggle">
                  family vault
                  <svg className="squiggle" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M2 9 Q 28 1 54 7 T 106 7 T 158 7 T 198 6"
                      fill="none"
                      stroke="#C97B5C"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>{' '}
                with us.
              </h2>
              <p>We're launching soon. Drop your email and we'll tell you the day it opens — your family will be among the first to save, plan, and grow together.</p>

              <div className="finale-buttons">
                <button className="btn btn-l btn-gradient" onClick={openWaitlist}>Join the waitlist</button>
                <a
                  href="https://x.com/cashflow_fi"
                  target="_blank"
                  rel="noopener"
                  className="finale-sublink"
                >
                  or follow along on Twitter
                  <svg viewBox="0 0 24 14" aria-hidden="true"><path d="M2 7 Q 8 3 16 7 M12 3 L16 7 L12 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </a>
              </div>
            </div>

            <div className="finale-photo">
              <span className="finale-tape" aria-hidden="true" />
              <img src="/assets/family/family3.png" alt="Parents sharing a joyful moment with their kids" />
              <span className="finale-caption">our first family goal</span>
            </div>
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
          </div>
        </div>
      </footer>

      <WaitlistModal open={waitlistOpen} onClose={() => setWaitlistOpen(false)} />
    </div>
  );
}
