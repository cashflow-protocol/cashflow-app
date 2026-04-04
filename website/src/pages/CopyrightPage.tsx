import { useEffect } from 'react';
import { Link } from 'react-router';
import '../styles/legal.css';

export default function CopyrightPage() {
  useEffect(() => {
    document.title = 'Copyright — Cashflow';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="legal-page">
      <div className="legal-container">
        <Link to="/" className="legal-back">← Back to Home</Link>
        <h1>Copyright</h1>
        <p className="legal-date">Effective date: April 3, 2026</p>

        <h2>1. Ownership</h2>
        <p>
          All content, features, and functionality of the Cashflow application and website —
          including but not limited to text, graphics, logos, icons, images, audio, video,
          software, and underlying code — are the exclusive property of Cashflow and are
          protected by international copyright, trademark, patent, trade secret, and other
          intellectual property laws.
        </p>

        <h2>2. Copyright Notice</h2>
        <p>
          &copy; 2026 Cashflow. All rights reserved. No part of this application, website,
          or any associated materials may be reproduced, distributed, or transmitted in any
          form or by any means without the prior written permission of Cashflow.
        </p>

        <h2>3. Permitted Use</h2>
        <p>
          You may access and use the App and website for personal, non-commercial purposes
          in accordance with our <Link to="/licence">Licence</Link>. Any other use — including
          reproduction, modification, distribution, republication, or display — requires
          explicit written consent from Cashflow.
        </p>

        <h2>4. Trademarks</h2>
        <p>
          "Cashflow", the Cashflow logo, and all related names, logos, product and service
          names, designs, and slogans are trademarks of Cashflow. You may not use these marks
          without prior written permission. All other names, logos, product and service names,
          designs, and slogans on this website are the trademarks of their respective owners.
        </p>

        <h2>5. User-Generated Content</h2>
        <p>
          By submitting content through the App (such as feedback or support requests), you
          grant Cashflow a non-exclusive, worldwide, royalty-free licence to use, reproduce,
          and display that content in connection with operating and improving the App.
        </p>

        <h2>6. Third-Party Content</h2>
        <p>
          The App may display content from third-party sources, including blockchain data,
          token metadata, and protocol information. Such content is the property of its
          respective owners and is displayed under fair use or applicable licence agreements.
          Cashflow does not claim ownership of third-party content.
        </p>

        <h2>7. DMCA / Copyright Infringement</h2>
        <p>
          If you believe that any content on the App infringes your copyright, please send a
          written notice to <a href="mailto:legal@cashflow.fun">legal@cashflow.fun</a> with
          the following information:
        </p>
        <ul>
          <li>A description of the copyrighted work you claim has been infringed.</li>
          <li>A description of where the infringing material is located within the App.</li>
          <li>Your contact information (name, address, email, phone number).</li>
          <li>A statement that you have a good-faith belief that the use is not authorised by the copyright owner.</li>
          <li>A statement, under penalty of perjury, that the information in your notice is accurate and that you are the copyright owner or authorised to act on their behalf.</li>
          <li>Your physical or electronic signature.</li>
        </ul>

        <h2>8. Enforcement</h2>
        <p>
          Cashflow actively monitors and enforces its intellectual property rights. Unauthorised
          use of any materials may result in legal action, including claims for damages and
          injunctive relief.
        </p>

        <h2>9. Contact</h2>
        <p>
          For copyright-related inquiries, contact us at{' '}
          <a href="mailto:legal@cashflow.fun">legal@cashflow.fun</a>.
        </p>
      </div>
    </div>
  );
}
