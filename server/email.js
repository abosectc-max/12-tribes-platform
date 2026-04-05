/**
 * server/email.js — Pure email utilities
 *
 * Self-contained module: depends only on node:https + env vars.
 * No database access — all DB-dependent orchestrators stay in standalone.js.
 *
 * Exports:
 *   sendEmail              — raw Resend API call
 *   brandedEmailTemplate   — master HTML wrapper with logo + legal footer
 *   tradeConfirmationHtml  — trade executed notification body
 *   accountUpdateHtml      — deposit / withdrawal / fee notification body
 *   announcementHtml       — platform announcement notification body
 *   onboardingWelcomeHtml  — new-investor welcome body
 *   passwordResetEmail     — complete branded password-reset email (HTML string)
 *   emailVerificationEmail — complete branded email-verification email (HTML string)
 *   accessApprovedEmail    — complete branded access-approved email (HTML string)
 *   accessDeniedEmail      — complete branded access-denied email (HTML string)
 *   PLATFORM_URL           — investor portal deep-link (Vercel CDN origin)
 *   SUPPORT_EMAIL          — support contact address
 */

// ─── Config (read from env — same sources as standalone.js) ───
const RESEND_API_KEY   = process.env.RESEND_API_KEY  || '';
const FROM_EMAIL       = process.env.FROM_EMAIL      || 'onboarding@resend.dev';
const FRONTEND_ORIGIN  = process.env.FRONTEND_URL    || 'https://12-tribes-platform.vercel.app';
const APP_NAME         = '12 Tribes Investments';

// ─── Email URL constants ───
export const LOGO_URL      = `${FRONTEND_ORIGIN}/logo-icon.svg`;
export const LOGO_URL_PNG  = `${FRONTEND_ORIGIN}/icons/icon-192.png`;
export const PLATFORM_URL  = `${FRONTEND_ORIGIN}/investor-portal`;
export const SUPPORT_EMAIL = 'support@12tribesinvestments.com';

// ─── HTML escaping utility ───
// MUST be applied to ALL user-supplied strings interpolated into HTML email templates.
// Prevents stored/reflected XSS in email clients that render raw HTML.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ─── Raw email send (Resend API) ───
export async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.warn(`[Email] No RESEND_API_KEY set. Would send to ${to}: "${subject}"`);
    return { success: false, reason: 'no_api_key' };
  }

  try {
    const payload = JSON.stringify({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    });

    const https = await import('node:https');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Email] Sent to ${to}: "${subject}"`);
            resolve({ success: true });
          } else {
            console.error(`[Email] Failed (${res.statusCode}): ${body}`);
            resolve({ success: false, reason: body });
          }
        });
      });
      req.on('error', (err) => {
        console.error(`[Email] Error: ${err.message}`);
        resolve({ success: false, reason: err.message });
      });
      req.write(payload);
      req.end();
    });
  } catch (err) {
    console.error(`[Email] Exception: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// ═══════════════════════════════════════════
//   BRANDED EMAIL TEMPLATE SYSTEM
//   All notifications use this wrapper for consistent branding:
//   - 12 Tribes logo (hosted on Vercel CDN)
//   - Personalized greeting with user's name
//   - Dynamic content area
//   - Legal terms & conditions footer
//   - SEC/FINRA compliance disclaimers
// ═══════════════════════════════════════════

/**
 * Master email template — wraps ANY email content with branded header + legal footer.
 * @param {string} userName — Recipient's first name or full name
 * @param {string} contentHtml — The email body (already formatted HTML)
 * @param {object} opts — { preheader, showCta, ctaText, ctaUrl, year }
 */
export function brandedEmailTemplate(userName, contentHtml, opts = {}) {
  const year = opts.year || new Date().getFullYear();
  const preheader = opts.preheader || '';
  const showCta = opts.showCta || false;
  const ctaText = opts.ctaText || 'Open Dashboard';
  const ctaUrl = opts.ctaUrl || PLATFORM_URL;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="supported-color-schemes" content="dark"/>
  <title>${APP_NAME}</title>
  <!--[if mso]><style>table,td{font-family:Arial,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#060612;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>` : ''}

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#060612;">
    <tr><td align="center" style="padding:32px 16px;">

      <!-- Email card -->
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0B1120;border-radius:16px;border:1px solid rgba(74,144,217,0.15);overflow:hidden;">

        <!-- ═══ HEADER: Logo + Brand ═══ -->
        <tr><td style="padding:32px 32px 20px;text-align:center;background:linear-gradient(180deg,#0B1A3B 0%,#0B1120 100%);">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="padding-right:14px;vertical-align:middle;">
                <img src="${LOGO_URL}" alt="12 Tribes" width="64" height="64" onerror="this.onerror=null;this.src='${LOGO_URL_PNG}';" style="display:block;border-radius:14px;border:1px solid rgba(212,172,13,0.25);box-shadow:0 2px 12px rgba(212,172,13,0.15);" />
              </td>
              <td style="vertical-align:middle;text-align:left;">
                <div style="font-size:22px;font-weight:800;letter-spacing:1.5px;color:#D4AC0D;line-height:1.1;">12 TRIBES</div>
                <div style="font-size:10px;font-weight:600;letter-spacing:3px;color:#7BA3CC;margin-top:2px;">INVESTMENTS</div>
              </td>
            </tr>
          </table>
          <div style="margin-top:16px;height:1px;background:linear-gradient(90deg,transparent,rgba(212,172,13,0.3),transparent);"></div>
        </td></tr>

        <!-- ═══ GREETING ═══ -->
        <tr><td style="padding:24px 32px 8px;">
          <div style="font-size:16px;color:#E0E0E0;line-height:1.5;">
            ${userName ? `Hello <strong style="color:#ffffff;">${escapeHtml(userName)}</strong>,` : 'Hello,'}
          </div>
        </td></tr>

        <!-- ═══ DYNAMIC CONTENT ═══ -->
        <tr><td style="padding:8px 32px 24px;">
          ${contentHtml}
        </td></tr>

        ${showCta ? `
        <!-- ═══ CALL TO ACTION ═══ -->
        <tr><td style="padding:0 32px 28px;text-align:center;">
          <a href="${ctaUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#D4AC0D,#F1C40F);color:#0B1A3B;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:0.5px;">${ctaText}</a>
        </td></tr>
        ` : ''}

        <!-- ═══ DIVIDER ═══ -->
        <tr><td style="padding:0 32px;">
          <div style="height:1px;background:rgba(255,255,255,0.06);"></div>
        </td></tr>

        <!-- ═══ LEGAL / TERMS & CONDITIONS FOOTER ═══ -->
        <tr><td style="padding:20px 32px 28px;">
          <div style="font-size:11px;color:#555;line-height:1.7;">
            <strong style="color:#666;font-size:10px;letter-spacing:1px;text-transform:uppercase;">Important Disclosures</strong><br/>
            This communication is from ${APP_NAME}, a technology-assisted investment platform. All investment strategies involve risk, including the possible loss of principal. Past performance does not guarantee future results. AI-generated trade signals are informational and do not constitute personalized investment advice.<br/><br/>
            Securities-related activities are conducted in compliance with applicable SEC and FINRA regulations. ${APP_NAME} does not guarantee any specific outcome or profit. By using our platform, you acknowledge and agree to our <a href="${FRONTEND_ORIGIN}/terms" style="color:#7BA3CC;text-decoration:underline;">Terms of Service</a> and <a href="${FRONTEND_ORIGIN}/privacy" style="color:#7BA3CC;text-decoration:underline;">Privacy Policy</a>.<br/><br/>
            <span style="color:#444;">If you have questions, contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#7BA3CC;text-decoration:none;">${SUPPORT_EMAIL}</a></span><br/>
            <span style="color:#333;">&copy; ${year} ${APP_NAME}. All rights reserved.</span>
          </div>
        </td></tr>

      </table>
      <!-- End email card -->

    </td></tr>
  </table>
</body>
</html>`;
}

// ─── NOTIFICATION EMAIL BUILDERS ───
// Each returns fully-branded HTML via brandedEmailTemplate()

export function tradeConfirmationHtml(trade) {
  const side = trade.side === 'LONG' ? 'BUY' : 'SELL';
  const sideColor = side === 'BUY' ? '#10B981' : '#EF4444';
  const cost = (trade.price * trade.quantity).toFixed(2);
  const time = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;color:${sideColor};margin-bottom:14px;letter-spacing:0.5px;">
        ${side === 'BUY' ? '&#9650;' : '&#9660;'} Trade Executed — ${side} ${trade.symbol}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:6px 0;color:#888;width:40%;">Symbol</td><td style="padding:6px 0;font-weight:700;color:#fff;">${trade.symbol}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Side</td><td style="padding:6px 0;font-weight:700;color:${sideColor};">${side}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Quantity</td><td style="padding:6px 0;color:#E0E0E0;">${trade.quantity}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Price</td><td style="padding:6px 0;color:#E0E0E0;">$${Number(trade.price).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);color:#888;">Total Value</td><td style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);font-weight:700;color:#D4AC0D;">$${cost}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">AI Agent</td><td style="padding:6px 0;color:#A855F7;">${trade.agent || 'Manual'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Mode</td><td style="padding:6px 0;color:#888;text-transform:uppercase;font-size:11px;letter-spacing:1px;">${trade.execution_mode || 'paper'}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Executed</td><td style="padding:6px 0;color:#888;">${time}</td></tr>
      </table>
    </div>
    <div style="font-size:12px;color:#666;line-height:1.5;">
      This trade was executed ${trade.agent ? 'by AI agent <strong style="color:#A855F7;">' + trade.agent + '</strong>' : 'manually'} on your behalf.
      Review your full portfolio in the dashboard.
    </div>`;
}

export function accountUpdateHtml(updateType, details) {
  const icons = { deposit: '&#128176;', withdrawal: '&#128178;', fee: '&#128202;', balance: '&#9889;', settings: '&#9881;' };
  const colors = { deposit: '#10B981', withdrawal: '#F59E0B', fee: '#8B5CF6', balance: '#3B82F6', settings: '#6B7280' };
  const icon = icons[updateType] || '&#128276;';
  const color = colors[updateType] || '#00D4FF';
  return `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:14px;font-weight:700;color:${color};margin-bottom:12px;">
        ${icon} ${details.title || 'Account Update'}
      </div>
      <div style="font-size:14px;color:#ccc;line-height:1.6;">
        ${details.message}
      </div>
      ${details.amount ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
          <tr><td style="color:#888;">Amount</td><td style="text-align:right;font-weight:700;color:${color};">$${Number(details.amount).toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>
          ${details.newBalance ? `<tr><td style="color:#888;padding-top:6px;">New Balance</td><td style="text-align:right;color:#fff;padding-top:6px;">$${Number(details.newBalance).toLocaleString('en-US', {minimumFractionDigits:2})}</td></tr>` : ''}
        </table>
      </div>` : ''}
    </div>`;
}

export function announcementHtml(headline, body, urgency) {
  const urgencyColors = { info: '#3B82F6', important: '#F59E0B', critical: '#EF4444' };
  const urgencyLabels = { info: 'Platform Update', important: 'Important Notice', critical: 'Action Required' };
  const color = urgencyColors[urgency] || urgencyColors.info;
  const label = urgencyLabels[urgency] || urgencyLabels.info;
  return `
    <div style="background:rgba(255,255,255,0.03);border:1px solid ${color}33;border-left:3px solid ${color};border-radius:0 12px 12px 0;padding:20px;margin-bottom:16px;">
      <div style="font-size:10px;font-weight:700;color:${color};letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">${label}</div>
      <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:12px;">${headline}</div>
      <div style="font-size:14px;color:#ccc;line-height:1.7;">${body}</div>
    </div>`;
}

export function onboardingWelcomeHtml(firstName) {
  return `
    <div style="font-size:14px;color:#ccc;line-height:1.7;margin-bottom:20px;">
      Welcome to <strong style="color:#D4AC0D;">12 Tribes Investments</strong> — an AI-powered collective investment platform engineered for precision, transparency, and disciplined wealth-building.
    </div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#D4AC0D;margin-bottom:14px;letter-spacing:0.5px;">Getting Started</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:#D4AC0D;font-weight:700;width:24px;">1.</td>
          <td style="padding:8px 0;color:#ccc;"><strong style="color:#fff;">Complete KYC Verification</strong> — Verify your identity to unlock full trading capabilities.</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:#D4AC0D;font-weight:700;">2.</td>
          <td style="padding:8px 0;color:#ccc;"><strong style="color:#fff;">Review Your Portfolio</strong> — Your initial allocation has been configured by the fund manager.</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:#D4AC0D;font-weight:700;">3.</td>
          <td style="padding:8px 0;color:#ccc;"><strong style="color:#fff;">Explore AI Agents</strong> — Our proprietary trading agents (SENTINEL, MOMENTUM, CONTRARIAN) work around the clock.</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:#D4AC0D;font-weight:700;">4.</td>
          <td style="padding:8px 0;color:#ccc;"><strong style="color:#fff;">Monitor Signals</strong> — Real-time trade signals are visible in your dashboard.</td>
        </tr>
      </table>
    </div>
    <div style="font-size:13px;color:#888;line-height:1.6;">
      Your fund manager, <strong style="color:#fff;">Anthony Bose</strong>, oversees all investment strategies and risk parameters.
      If you have any questions, reach out through the platform's messaging system or reply to this email.
    </div>`;
}

export function passwordResetEmail(code) {
  const content = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;">
      <div style="font-size:14px;color:#ccc;margin-bottom:16px;">Your password reset code is:</div>
      <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#D4AC0D;font-family:'SF Mono',SFMono-Regular,Consolas,monospace;padding:8px 0;">${code}</div>
      <div style="font-size:12px;color:#888;margin-top:16px;">This code expires in <strong style="color:#F59E0B;">10 minutes</strong>.</div>
    </div>
    <div style="font-size:12px;color:#666;text-align:center;">
      If you didn't request this reset, you can safely ignore this email. Your account is secure.
    </div>`;
  return brandedEmailTemplate(null, content, { preheader: `Your password reset code: ${code}` });
}

export function emailVerificationEmail(code) {
  const content = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;">
      <div style="font-size:14px;color:#ccc;margin-bottom:16px;">Verify your email address:</div>
      <div style="font-size:40px;font-weight:800;letter-spacing:10px;color:#10B981;font-family:'SF Mono',SFMono-Regular,Consolas,monospace;padding:8px 0;">${code}</div>
      <div style="font-size:12px;color:#888;margin-top:16px;">Enter this code in the app. Expires in <strong style="color:#10B981;">10 minutes</strong>.</div>
    </div>
    <div style="font-size:13px;color:#888;text-align:center;">
      Welcome to the collective.
    </div>`;
  return brandedEmailTemplate(null, content, { preheader: `Your verification code: ${code}` });
}

export function accessApprovedEmail(firstName) {
  const content = `
    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:16px;font-weight:700;color:#10B981;margin-bottom:12px;">&#10003; Access Approved</div>
      <div style="font-size:14px;color:#ccc;line-height:1.7;">
        Your request to join <strong style="color:#D4AC0D;">12 Tribes Investments</strong> has been approved. You can now create your account and begin exploring our AI-powered investment platform.
      </div>
    </div>`;
  return brandedEmailTemplate(firstName, content, {
    preheader: 'Your access has been approved — welcome to 12 Tribes Investments',
    showCta: true, ctaText: 'Create Your Account', ctaUrl: `${FRONTEND_ORIGIN}/investor-portal?mode=register`,
  });
}

export function accessDeniedEmail(firstName) {
  const content = `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-size:16px;font-weight:700;color:#F59E0B;margin-bottom:12px;">Access Request Update</div>
      <div style="font-size:14px;color:#ccc;line-height:1.7;">
        Thank you for your interest in <strong style="color:#D4AC0D;">12 Tribes Investments</strong>. After careful review, we are unable to grant platform access at this time. If you believe this was in error, please contact our support team for further information.
      </div>
    </div>`;
  return brandedEmailTemplate(firstName, content, {
    preheader: 'Update on your 12 Tribes Investments access request',
  });
}
