import { useEffect } from 'react';
import { Link } from 'react-router';
import '../styles/legal.css';

export default function LicencePage() {
  useEffect(() => {
    document.title = 'Licence — Cashflow';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">← Back to Home</Link>
        <h1>Licence</h1>
        <p className="legal-date">Effective date: April 3, 2026</p>

        <h2>1. Grant of Licence</h2>
        <p>
          Cashflow grants you a limited, non-exclusive, non-transferable, revocable licence to
          download, install, and use the Cashflow mobile application ("App") on a device you own
          or control, strictly in accordance with these terms.
        </p>

        <h2>2. Restrictions</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Copy, modify, distribute, sell, or lease any part of the App or its content.</li>
          <li>Reverse-engineer, decompile, or disassemble the App, except where applicable law expressly permits it.</li>
          <li>Attempt to extract the source code of the App.</li>
          <li>Use the App for any unlawful purpose or in violation of any applicable regulation.</li>
          <li>Remove, alter, or obscure any proprietary notices in the App.</li>
        </ul>

        <h2>3. Intellectual Property</h2>
        <p>
          All rights, title, and interest in and to the App — including but not limited to graphics,
          user interface, scripts, and software — are owned by Cashflow. This licence does not grant
          you any rights to trademarks, service marks, or trade names of Cashflow.
        </p>

        <h2>4. Open-Source Components</h2>
        <p>
          The App may include open-source software components governed by their own licence terms.
          Nothing in this licence limits your rights under, or grants you rights that supersede,
          the terms of any applicable open-source licence.
        </p>

        <h2>5. Third-Party Services</h2>
        <p>
          The App integrates with third-party services and protocols on the Solana blockchain.
          Your use of those services is subject to their respective terms of service. Cashflow
          is not responsible for the availability, accuracy, or conduct of any third-party service.
        </p>

        <h2>6. Disclaimer of Warranties</h2>
        <p>
          The App is provided "as is" and "as available" without warranties of any kind, whether
          express or implied, including but not limited to implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, Cashflow shall not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or any loss of profits
          or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill,
          or other intangible losses resulting from your use of the App.
        </p>

        <h2>8. Termination</h2>
        <p>
          This licence is effective until terminated. Cashflow may terminate or suspend your access
          at any time, without prior notice or liability, for any reason, including breach of these
          terms. Upon termination, your right to use the App ceases immediately.
        </p>

        <h2>9. Changes to This Licence</h2>
        <p>
          Cashflow reserves the right to modify this licence at any time. Updated terms will be
          posted on this page with a revised effective date. Continued use of the App after changes
          constitutes acceptance of the updated licence.
        </p>

        <h2>10. Contact</h2>
        <p>
          If you have questions about this licence, contact us at{' '}
          <a href="mailto:legal@cashflow.fun">legal@cashflow.fun</a>.
        </p>
      </div>
    </div>
  );
}
