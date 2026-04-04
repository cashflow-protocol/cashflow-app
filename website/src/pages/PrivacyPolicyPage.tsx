import { useEffect } from 'react';
import { Link } from 'react-router';
import '../styles/legal.css';

export default function PrivacyPolicyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy — Cashflow';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">← Back to Home</Link>
        <h1>Privacy Policy</h1>
        <p className="legal-date">Effective date: April 3, 2026</p>

        <h2>1. Introduction</h2>
        <p>
          Cashflow ("we", "our", or "us") is committed to protecting your privacy. This Privacy
          Policy explains how we collect, use, disclose, and safeguard your information when you
          use our mobile application and website (collectively, the "Service").
        </p>

        <h2>2. Information We Collect</h2>

        <p><strong>Information you provide directly:</strong></p>
        <ul>
          <li>Email address — when you sign up, join the waitlist, or contact support.</li>
          <li>Wallet addresses — when you connect a Solana wallet to use the App.</li>
        </ul>

        <p><strong>Information collected automatically:</strong></p>
        <ul>
          <li>Device information — device type, operating system, and version.</li>
          <li>Usage data — features accessed, interaction patterns, and session duration.</li>
          <li>Log data — IP address, browser type, access times, and referring URLs.</li>
        </ul>

        <p><strong>Blockchain data:</strong></p>
        <ul>
          <li>
            Transactions you initiate through the App are recorded on the Solana blockchain,
            which is publicly accessible. We do not control blockchain data and cannot modify
            or delete it.
          </li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide, maintain, and improve the Service.</li>
          <li>Process transactions and send related notifications.</li>
          <li>Communicate with you about updates, security alerts, and support.</li>
          <li>Detect, prevent, and address fraud, abuse, or technical issues.</li>
          <li>Comply with legal obligations and enforce our terms.</li>
        </ul>

        <h2>4. Sharing of Information</h2>
        <p>We do not sell your personal information. We may share information with:</p>
        <ul>
          <li><strong>Service providers</strong> — third parties that help us operate the Service (analytics, hosting, authentication via Privy).</li>
          <li><strong>Blockchain networks</strong> — transaction data is broadcast to the Solana network as part of normal operation.</li>
          <li><strong>Legal requirements</strong> — when required by law, regulation, or legal process.</li>
          <li><strong>Business transfers</strong> — in connection with a merger, acquisition, or sale of assets.</li>
        </ul>

        <h2>5. Data Retention</h2>
        <p>
          We retain your personal information only for as long as necessary to fulfil the purposes
          described in this policy, unless a longer retention period is required or permitted by law.
          On-chain transaction data is permanent and cannot be deleted.
        </p>

        <h2>6. Data Security</h2>
        <p>
          We implement industry-standard technical and organisational measures to protect your
          information, including encryption in transit and at rest. However, no method of
          electronic transmission or storage is 100% secure, and we cannot guarantee absolute
          security.
        </p>

        <h2>7. Your Rights</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access the personal information we hold about you.</li>
          <li>Request correction of inaccurate information.</li>
          <li>Request deletion of your personal information.</li>
          <li>Object to or restrict processing of your information.</li>
          <li>Data portability — receive your data in a structured, machine-readable format.</li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:legal@cashflow.fun">legal@cashflow.fun</a>.
        </p>

        <h2>8. Third-Party Services</h2>
        <p>
          The Service integrates with third-party platforms (including Solana blockchain protocols,
          Privy for authentication, and wallet providers). These services have their own privacy
          policies, and we encourage you to review them. We are not responsible for the privacy
          practices of third parties.
        </p>

        <h2>9. Children's Privacy</h2>
        <p>
          The Service is not directed to individuals under the age of 18. We do not knowingly
          collect personal information from children. If we learn that we have collected
          information from a child, we will take steps to delete it promptly.
        </p>

        <h2>10. International Transfers</h2>
        <p>
          Your information may be transferred to and processed in countries other than your own.
          We take appropriate safeguards to ensure your information is protected in accordance
          with this policy.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. The updated version will be
          indicated by a revised effective date at the top of this page. We encourage you to
          review this policy periodically.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          If you have questions or concerns about this Privacy Policy, contact us at{' '}
          <a href="mailto:legal@cashflow.fun">legal@cashflow.fun</a>.
        </p>
      </div>
    </div>
  );
}
