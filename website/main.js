// Scroll reveal
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
reveals.forEach(el => observer.observe(el));

// Navbar scroll effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// Waitlist modal
(function () {
  const API_BASE = 'https://api.cashflow.fun/waitlist/v1';

  const modal = document.getElementById('waitlist-modal');
  const closeBtn = document.getElementById('modal-close');

  const emailStep = document.getElementById('waitlist-email');
  const verifyStep = document.getElementById('waitlist-verify');
  const successStep = document.getElementById('waitlist-success');

  const emailInput = document.getElementById('waitlist-input');
  const sendBtn = document.getElementById('waitlist-send');
  const emailError = document.getElementById('waitlist-email-error');

  const codeInput = document.getElementById('waitlist-code');
  const confirmBtn = document.getElementById('waitlist-confirm');
  const verifyError = document.getElementById('waitlist-verify-error');
  const sentEmailSpan = document.getElementById('waitlist-sent-email');

  let currentEmail = '';

  function openModal() {
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('open'));
    emailInput.focus();
    document.body.style.overflow = 'hidden';
  }

  function resetModal() {
    emailStep.style.display = '';
    verifyStep.style.display = 'none';
    successStep.style.display = 'none';
    emailInput.value = '';
    codeInput.value = '';
    showError(emailError, '');
    showError(verifyError, '');
    currentEmail = '';
  }

  function closeModal() {
    modal.classList.remove('open');
    setTimeout(() => {
      modal.style.display = 'none';
      document.body.style.overflow = '';
      resetModal();
    }, 300);
  }

  document.querySelectorAll('.open-waitlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal();
    });
  });

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') closeModal();
  });

  function showError(el, msg) {
    el.textContent = msg;
  }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? '...' : btn.dataset.originalText;
  }

  // Step 1: Send verification code
  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    showError(emailError, '');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError(emailError, 'Please enter a valid email address.');
      return;
    }

    setLoading(sendBtn, true);
    try {
      const res = await fetch(API_BASE + '/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError(emailError, data.error || 'Something went wrong.');
        return;
      }

      if (data.message === 'Already on waitlist') {
        emailStep.style.display = 'none';
        successStep.style.display = '';
        return;
      }

      currentEmail = email;
      sentEmailSpan.textContent = email;
      emailStep.style.display = 'none';
      verifyStep.style.display = '';
      codeInput.focus();
    } catch {
      showError(emailError, 'Network error. Please try again.');
    } finally {
      setLoading(sendBtn, false);
    }
  });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });

  // Step 2: Verify code
  confirmBtn.addEventListener('click', async () => {
    const code = codeInput.value.trim();
    showError(verifyError, '');

    if (!code || code.length !== 6) {
      showError(verifyError, 'Please enter the 6-digit code.');
      return;
    }

    setLoading(confirmBtn, true);
    try {
      const res = await fetch(API_BASE + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentEmail, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        showError(verifyError, data.error || 'Verification failed.');
        return;
      }

      verifyStep.style.display = 'none';
      successStep.style.display = '';
    } catch {
      showError(verifyError, 'Network error. Please try again.');
    } finally {
      setLoading(confirmBtn, false);
    }
  });

  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBtn.click();
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '');
  });
})();
