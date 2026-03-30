/**
 * Terms & Conditions Page
 * Mandatory acceptance flow with full legal disclosure
 * Component includes acceptance gate modal and full terms document
 */

import { useState, useEffect } from 'react';

const STORAGE_KEY = '12tribes_terms_accepted';

/**
 * Check if user has already accepted terms
 * @param {string} userId - User identifier
 * @returns {object|null} Acceptance record or null
 */
function checkTermsAccepted(userId) {
  if (!userId) return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;

  const accepted = JSON.parse(stored);
  if (accepted[userId]) {
    return accepted[userId];
  }
  return null;
}

/**
 * Store terms acceptance
 * @param {string} userId - User identifier
 */
function acceptTerms(userId) {
  const accepted = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  accepted[userId] = {
    acceptedAt: new Date().toISOString(),
    version: '1.0'
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accepted));
}

/**
 * TermsConditions Component
 * @param {function} onAccept - Callback when terms are accepted
 * @param {string} userId - Current user identifier
 */
export default function TermsConditions({ onAccept, userId }) {
  const [hasAccepted, setHasAccepted] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(false);
  const [checkedCheckbox, setCheckedCheckbox] = useState(false);
  const [showModal, setShowModal] = useState(true);

  useEffect(() => {
    // Check if already accepted
    if (userId && checkTermsAccepted(userId)) {
      setHasAccepted(true);
      if (onAccept) {
        onAccept();
      }
      setShowModal(false);
      return;
    }
  }, [userId, onAccept]);

  const handleScroll = (e) => {
    const element = e.target;
    const isBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 50;
    setIsScrolledToBottom(isBottom);
  };

  const handleAccept = () => {
    if (userId) {
      acceptTerms(userId);
    }
    setHasAccepted(true);
    setShowModal(false);
    if (onAccept) {
      onAccept();
    }
  };

  const glass = {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 24,
    boxShadow: "0 4px 30px rgba(0,0,0,0.06), inset 0 0.5px 0 rgba(255,255,255,0.4)",
  };
  const sectionStyle = { marginBottom: 24 };
  const h3Style = { fontSize: 14, fontWeight: 700, color: "#D4AC0D", marginBottom: 8, marginTop: 20 };
  const pStyle = { fontSize: 13, color: "rgba(255,255,255,0.65)", lineHeight: 1.8, marginBottom: 10 };
  const strongStyle = { color: "rgba(255,255,255,0.85)", fontWeight: 600 };
  const ulStyle = { paddingLeft: 24, marginBottom: 12 };
  const liStyle = { fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 6 };

  if (!showModal && hasAccepted) {
    return null;
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #0a0a1a 0%, #0d1117 30%, #0a0f1e 60%, #111827 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
      color: "#fff", padding: 16,
    }}>
      {showModal && (
        <div style={{ maxWidth: 720, width: "100%" }}>
          <div style={{ ...glass, overflow: "hidden" }}>
            <div style={{ padding: "28px 32px 16px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", letterSpacing: 1 }}>Terms & Conditions</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>Please read and accept to continue</p>
            </div>

            <div
              style={{ maxHeight: "55vh", overflowY: "auto", padding: "24px 32px" }}
              onScroll={handleScroll}
              role="region"
              aria-label="Terms and conditions content"
            >
              {/* SECTION 1: ACCEPTANCE OF TERMS */}
              <section style={sectionStyle}>
                <h3>1. ACCEPTANCE OF TERMS</h3>
                <p>
                  By accessing and using the 12 Tribes AI Investment Group platform (the "Platform"),
                  you agree to be bound by these Terms & Conditions and all applicable laws and
                  regulations. If you do not agree to abide by the above, please do not use this
                  service.
                </p>
                <p>
                  <strong>Age Requirement:</strong> You must be at least 18 years of age to use this
                  Platform. By accessing this Platform, you represent and warrant that you are 18
                  years of age or older.
                </p>
                <p>
                  <strong>Modification of Terms:</strong> 12 Tribes AI Investment Group reserves the
                  right to modify these Terms & Conditions at any time. Changes will be effective
                  immediately upon posting to the Platform. Your continued use of the Platform
                  following the posting of revised Terms & Conditions means that you accept and agree
                  to the changes.
                </p>
              </section>

              {/* SECTION 2: PLATFORM DESCRIPTION */}
              <section style={sectionStyle}>
                <h3>2. PLATFORM DESCRIPTION</h3>
                <p>
                  The 12 Tribes AI Investment Group Platform is an AI-powered investment simulation
                  and educational platform. The Platform provides users with virtual currency
                  ($100,000 per investor) to conduct paper trading and test investment strategies in
                  a simulated environment.
                </p>
                <p>
                  <strong>Not a Broker-Dealer:</strong> The Platform is NOT a registered
                  broker-dealer, investment advisor, or financial institution. No real securities are
                  traded, and no real money or assets change hands. The Platform is not licensed by
                  the Securities and Exchange Commission (SEC) or any other financial regulatory body.
                </p>
                <p>
                  <strong>Educational Purpose:</strong> The Platform is designed for educational,
                  simulation, and training purposes only. It allows users to learn about investment
                  strategies, market dynamics, and portfolio management in a risk-free virtual
                  environment.
                </p>
              </section>

              {/* SECTION 3: NO INVESTMENT ADVICE */}
              <section style={sectionStyle}>
                <h3>3. NO INVESTMENT ADVICE</h3>
                <p>
                  <strong>Disclaimer:</strong> Nothing on this Platform, including but not limited to
                  trading signals, AI recommendations, market analysis, or educational content,
                  constitutes investment advice, financial advice, or a recommendation to buy or sell
                  any security.
                </p>
                <p>
                  All content provided by the Platform, including AI-generated signals and
                  recommendations, is for informational and educational purposes only. Users should
                  not rely on the Platform's content for making real investment decisions.
                </p>
                <p>
                  <strong>Professional Consultation Required:</strong> Before making any real
                  investment decision with actual funds, users should consult with a qualified,
                  licensed financial advisor, investment manager, or tax professional who understands
                  their personal financial situation, goals, and risk tolerance.
                </p>
                <p>
                  Past performance (whether simulated or otherwise) is not indicative of future
                  results. Hypothetical results are inherently limited and may not reflect real-world
                  conditions.
                </p>
              </section>

              {/* SECTION 4: VIRTUAL TRADING DISCLAIMER */}
              <section style={sectionStyle}>
                <h3>4. VIRTUAL TRADING DISCLAIMER</h3>
                <p>
                  All trades executed on the Platform use virtual currency and are simulated trades.
                  No real money or securities are involved. Virtual trading does not expose users to
                  real financial risk or loss.
                </p>
                <p>
                  <strong>Limitations of Simulated Trading:</strong> Simulated trading has significant
                  limitations compared to actual trading, including but not limited to:
                </p>
                <ul>
                  <li>
                    No real market impact: Orders are filled at theoretical prices without considering
                    actual market slippage or liquidity constraints
                  </li>
                  <li>
                    Idealized execution: Trades are executed at midpoint prices without bid-ask
                    spreads or commission costs
                  </li>
                  <li>
                    No emotional factors: Simulated trading does not account for the psychological
                    stress and decision-making challenges of real trading with real capital at risk
                  </li>
                  <li>
                    Historical data limitations: Backtested results may not account for all market
                    conditions or black swan events
                  </li>
                  <li>
                    No tax implications: Virtual trading does not account for capital gains taxes,
                    wash sale rules, or other tax consequences of real trading
                  </li>
                </ul>
                <p>
                  Hypothetical performance results are subject to the fact that they are designed with
                  the benefit of hindsight. No representation is being made that any account will or
                  is likely to achieve profits similar to those shown.
                </p>
              </section>

              {/* SECTION 5: AI AGENT DISCLOSURE */}
              <section style={sectionStyle}>
                <h3>5. AI AGENT DISCLOSURE</h3>
                <p>
                  The Platform uses artificial intelligence agents to generate trading signals and
                  recommendations. Users should understand the limitations and risks of AI-driven
                  strategies:
                </p>
                <ul>
                  <li>
                    <strong>No Guarantees:</strong> AI-generated signals and recommendations are not
                    guaranteed to be accurate or profitable
                  </li>
                  <li>
                    <strong>Model Degradation:</strong> AI models may degrade in accuracy over time,
                    particularly during novel market conditions or structural market changes
                  </li>
                  <li>
                    <strong>Limited Data:</strong> AI performance is limited by the quality and
                    completeness of historical training data
                  </li>
                  <li>
                    <strong>Past Accuracy ≠ Future Accuracy:</strong> An AI agent's past performance
                    does not guarantee or indicate future performance
                  </li>
                  <li>
                    <strong>Edge Cases:</strong> AI models may fail unexpectedly during extreme market
                    conditions or unprecedented scenarios
                  </li>
                  <li>
                    <strong>Adversarial Vulnerabilities:</strong> AI systems may be susceptible to
                    adversarial inputs or market manipulation tactics
                  </li>
                </ul>
                <p>
                  Users should never rely solely on AI agents for real investment decision-making.
                </p>
              </section>

              {/* SECTION 6: RISK DISCLOSURE */}
              <section style={sectionStyle}>
                <h3>6. RISK DISCLOSURE</h3>
                <p>
                  <strong>Trading Involves Risk:</strong> While the Platform uses virtual currency,
                  users should understand that real trading involves substantial and potentially total
                  loss of invested capital. The following risks are inherent in all securities trading:
                </p>
                <ul>
                  <li>
                    <strong>Market Risk:</strong> Security prices fluctuate in response to market
                    conditions, economic data, geopolitical events, and investor sentiment
                  </li>
                  <li>
                    <strong>Volatility Risk:</strong> Price volatility can be extreme, particularly in
                    small-cap stocks, emerging markets, and derivatives
                  </li>
                  <li>
                    <strong>Liquidity Risk:</strong> Some securities may be difficult or impossible to
                    sell at a fair price, especially during market stress
                  </li>
                  <li>
                    <strong>Leverage Risk:</strong> Use of leverage (borrowed money) amplifies both
                    gains and losses, potentially leading to losses exceeding initial investment
                  </li>
                  <li>
                    <strong>Concentration Risk:</strong> Concentrated portfolios are more vulnerable to
                    declines in specific stocks or sectors
                  </li>
                  <li>
                    <strong>Timing Risk:</strong> Market entry and exit timing significantly affects
                    returns; "buying high" or "selling low" can lead to substantial losses
                  </li>
                  <li>
                    <strong>Black Swan Events:</strong> Unpredictable, extreme market events can cause
                    catastrophic losses not captured in historical data
                  </li>
                </ul>
                <p>
                  <strong>Past Performance Is Not Indicative of Future Results:</strong> No historical
                  investment return guarantees future performance. Market conditions change constantly,
                  and strategies that worked in the past may fail in the future.
                </p>
              </section>

              {/* SECTION 7: USER RESPONSIBILITIES */}
              <section style={sectionStyle}>
                <h3>7. USER RESPONSIBILITIES</h3>
                <p>Users of the Platform agree to:</p>
                <ul>
                  <li>
                    <strong>Maintain Account Security:</strong> Keep your passkey and password secure
                    and confidential. Do not share your credentials with anyone. You are responsible
                    for all activity on your account
                  </li>
                  <li>
                    <strong>Provide Accurate Information:</strong> Provide truthful, accurate, and
                    complete information during registration. Update information as needed to keep it
                    current
                  </li>
                  <li>
                    <strong>No Manipulation:</strong> Do not attempt to manipulate, game, or exploit
                    the Platform's systems or algorithms
                  </li>
                  <li>
                    <strong>No Reverse Engineering:</strong> Do not reverse engineer, decompile,
                    disassemble, or modify the Platform's code, algorithms, or AI models
                  </li>
                  <li>
                    <strong>Legal Use Only:</strong> Do not use the Platform for any illegal,
                    unethical, or fraudulent purpose. Do not use the Platform if prohibited by law in
                    your jurisdiction
                  </li>
                  <li>
                    <strong>Respect Intellectual Property:</strong> Do not copy, reproduce, or
                    distribute Platform content without permission
                  </li>
                  <li>
                    <strong>Respect Other Users:</strong> Do not harass, threaten, or engage in abusive
                    conduct toward other users
                  </li>
                </ul>
              </section>

              {/* SECTION 8: INTELLECTUAL PROPERTY */}
              <section style={sectionStyle}>
                <h3>8. INTELLECTUAL PROPERTY</h3>
                <p>
                  <strong>Ownership:</strong> All content, code, algorithms, AI models, designs,
                  graphics, and other materials on the Platform (collectively, "Platform IP") are the
                  exclusive property of 12 Tribes AI Investment Group or its licensors.
                </p>
                <p>
                  <strong>Limited License:</strong> 12 Tribes grants you a limited, non-exclusive,
                  non-transferable license to use the Platform for personal, educational purposes
                  only.
                </p>
                <p>
                  <strong>Restrictions:</strong> You may not copy, distribute, modify, create
                  derivative works from, publicly display, publicly perform, republish, download,
                  store, or transmit any Platform IP without the express written permission of 12
                  Tribes. All rights not expressly granted are reserved.
                </p>
              </section>

              {/* SECTION 9: DATA & PRIVACY */}
              <section style={sectionStyle}>
                <h3>9. DATA & PRIVACY</h3>
                <p>
                  <strong>Information Collected:</strong> The Platform collects the following
                  information:
                </p>
                <ul>
                  <li>Registration information (name, email, etc.)</li>
                  <li>Trading activity and transaction history</li>
                  <li>Portfolio positions and account balances</li>
                  <li>Risk questionnaire responses</li>
                  <li>User preferences and settings</li>
                  <li>Browser and device information</li>
                </ul>
                <p>
                  <strong>Local Storage:</strong> In the current version of the Platform, all user data
                  is stored locally on your device using browser localStorage. Data is NOT transmitted
                  to external servers.
                </p>
                <p>
                  <strong>Data Deletion:</strong> You can delete all your data at any time by clearing
                  your browser's localStorage or deleting your browser cache. Once deleted, this data
                  cannot be recovered.
                </p>
                <p>
                  <strong>Future Versions:</strong> Future versions of the Platform may implement
                  cloud storage or data synchronization across devices. Any such changes will be
                  communicated to users, and additional privacy policies will apply.
                </p>
              </section>

              {/* SECTION 10: LIMITATION OF LIABILITY */}
              <section style={sectionStyle}>
                <h3>10. LIMITATION OF LIABILITY</h3>
                <p>
                  <strong>Disclaimer of Warranties:</strong> The Platform is provided on an "AS IS" and
                  "AS AVAILABLE" basis without any warranties, express or implied. 12 Tribes makes no
                  warranties regarding:
                </p>
                <ul>
                  <li>The accuracy, completeness, or reliability of Platform content or data</li>
                  <li>The suitability of the Platform for any particular purpose</li>
                  <li>Uninterrupted or error-free operation of the Platform</li>
                  <li>The absence of viruses or harmful components</li>
                </ul>
                <p>
                  <strong>Limitation of Damages:</strong> To the maximum extent permitted by law, 12
                  Tribes shall not be liable for any indirect, incidental, special, consequential,
                  punitive, or exemplary damages, including but not limited to damages for loss of
                  profits, goodwill, use, data, or other intangible losses, even if 12 Tribes has been
                  advised of the possibility of such damages.
                </p>
                <p>
                  <strong>No Liability for Virtual Trading Losses:</strong> 12 Tribes is not liable
                  for any virtual trading losses, even if the losses result from errors, glitches,
                  downtime, or incorrect AI recommendations.
                </p>
                <p>
                  <strong>Maximum Liability Cap:</strong> The maximum total liability of 12 Tribes to
                  you for all claims arising out of or relating to these Terms or the Platform shall
                  not exceed any fees you have paid to 12 Tribes (if any). If you have not paid any
                  fees, 12 Tribes's liability is limited to zero dollars.
                </p>
              </section>

              {/* SECTION 11: INDEMNIFICATION */}
              <section style={sectionStyle}>
                <h3>11. INDEMNIFICATION</h3>
                <p>
                  You agree to indemnify, defend, and hold harmless 12 Tribes AI Investment Group, its
                  officers, directors, employees, agents, and licensors from and against any and all
                  claims, damages, losses, liabilities, and expenses (including reasonable attorneys'
                  fees) arising out of or relating to:
                </p>
                <ul>
                  <li>Your use of the Platform</li>
                  <li>Your violation of these Terms & Conditions</li>
                  <li>Your violation of any applicable law or regulation</li>
                  <li>Your infringement of any third-party intellectual property rights</li>
                  <li>Any content you submit or upload to the Platform</li>
                </ul>
              </section>

              {/* SECTION 12: DISPUTE RESOLUTION */}
              <section style={sectionStyle}>
                <h3>12. DISPUTE RESOLUTION</h3>
                <p>
                  <strong>Binding Arbitration:</strong> Any dispute, claim, or controversy arising out
                  of or relating to these Terms, the Platform, or your use thereof shall be resolved
                  by binding arbitration administered by JAMS (Judicial Arbitration and Mediation
                  Services) in accordance with its Comprehensive Arbitration Rules & Procedures.
                </p>
                <p>
                  <strong>Governing Law:</strong> These Terms shall be governed by and construed in
                  accordance with the laws of the State of Delaware, USA, without regard to its
                  conflicts of law principles.
                </p>
                <p>
                  <strong>Jurisdiction:</strong> You irrevocably submit to the jurisdiction of the
                  state and federal courts located in Delaware for the enforcement of any arbitration
                  award or other relief.
                </p>
              </section>

              {/* SECTION 13: TERMINATION */}
              <section style={sectionStyle}>
                <h3>13. TERMINATION</h3>
                <p>
                  <strong>Termination by You:</strong> You may terminate your use of the Platform at
                  any time by deleting your account or ceasing use.
                </p>
                <p>
                  <strong>Termination by 12 Tribes:</strong> 12 Tribes may terminate or suspend your
                  access to the Platform at any time, with or without cause and without notice.
                </p>
                <p>
                  <strong>Upon Termination:</strong> Upon termination, your right to use the Platform
                  immediately ceases. All virtual positions will be closed, and all virtual currency
                  and trading activity records may be deleted. Since no real funds are involved, there
                  are no real financial consequences.
                </p>
                <p>
                  <strong>Survival:</strong> Sections regarding limitation of liability, indemnification,
                  and dispute resolution shall survive termination of these Terms.
                </p>
              </section>

              {/* SECTION 14: CONTACT */}
              <section style={sectionStyle}>
                <h3>14. CONTACT</h3>
                <p>
                  If you have questions about these Terms & Conditions, please contact 12 Tribes AI
                  Investment Group at:
                </p>
                <ul>
                  <li>Email: legal@12tribes.ai</li>
                  <li>Platform: 12 Tribes AI Investment Group</li>
                  <li>Entity: 12 Tribes AI Investment Group LLC</li>
                </ul>
              </section>

              {/* FOOTER NOTE */}
              <section style={{ ...sectionStyle, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16 }}>
                <p>
                  <strong>Last Updated: March 27, 2026</strong>
                </p>
                <p>
                  This document is a comprehensive legal agreement covering the use of the 12 Tribes AI
                  Investment Group Platform. Please read carefully and ensure you understand all terms
                  before accepting. If you have questions, consult with a legal professional.
                </p>
              </section>
            </div>

            {/* Checkbox and Accept Button */}
            <div style={{ padding: "20px 32px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <label style={{
                display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
                opacity: isScrolledToBottom ? 1 : 0.4, pointerEvents: isScrolledToBottom ? "auto" : "none",
                marginBottom: 16,
              }}>
                <input
                  type="checkbox"
                  checked={checkedCheckbox}
                  onChange={(e) => setCheckedCheckbox(e.target.checked)}
                  disabled={!isScrolledToBottom}
                  style={{ width: 20, height: 20, marginTop: 2, accentColor: "#D4AC0D", cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
                  I have read, understood, and agree to the <strong style={{ color: "#D4AC0D" }}>Terms & Conditions</strong> of 12 Tribes AI Investment Group. I acknowledge that all trading on this platform uses virtual currency for simulation purposes only.
                </span>
              </label>

              <button
                onClick={handleAccept}
                disabled={!checkedCheckbox || !isScrolledToBottom}
                style={{
                  width: "100%", padding: "16px", borderRadius: 16, border: "none",
                  cursor: checkedCheckbox && isScrolledToBottom ? "pointer" : "default",
                  background: checkedCheckbox && isScrolledToBottom ? "linear-gradient(135deg, #D4AC0D, #FFD54F)" : "rgba(255,255,255,0.06)",
                  color: checkedCheckbox && isScrolledToBottom ? "#0a0a1a" : "rgba(255,255,255,0.2)",
                  fontSize: 16, fontWeight: 700, letterSpacing: 0.5,
                  boxShadow: checkedCheckbox && isScrolledToBottom ? "0 4px 20px rgba(212,172,13,0.3)" : "none",
                  transition: "all 0.3s",
                }}
              >
                {checkedCheckbox && isScrolledToBottom ? "Accept & Continue →" : "Please read and accept the terms above"}
              </button>

              {!isScrolledToBottom && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 8 }}>
                  ↓ Scroll to bottom to enable acceptance
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Post-acceptance confirmation */}
      {hasAccepted && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 16, color: "#10B981" }}>✓</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "#10B981", margin: "0 0 8px" }}>Terms Accepted</h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
            Accepted on {userId && checkTermsAccepted(userId) ? new Date(checkTermsAccepted(userId).acceptedAt).toLocaleDateString() : 'today'}
          </p>
        </div>
      )}
    </div>
  );
}

// Export helper functions for external use
export { checkTermsAccepted, acceptTerms };
