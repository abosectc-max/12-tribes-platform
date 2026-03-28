// ═══════════════════════════════════════════
//   12 TRIBES — BRAND LOGO COMPONENT
//   Inline SVG — geometric globe + gold "12"
//   High-contrast version for visibility at all sizes
// ═══════════════════════════════════════════

/**
 * BrandLogo — Renders the 12 Tribes globe icon inline.
 * @param {number} size - Width/height in px (default 48)
 * @param {boolean} showText - Show "12 TRIBES" + subtitle below icon
 * @param {string} textSize - Font size for brand name (default "32px")
 * @param {string} subtitleSize - Font size for subtitle
 * @param {object} style - Additional wrapper styles
 */
export default function BrandLogo({ size = 48, showText = false, textSize = "32px", subtitleSize = "11px", style = {} }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: showText ? 12 : 0, ...style }}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width={size} height={size} style={{ display: "block" }}>
        <defs>
          <linearGradient id="bl_gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFE082"/>
            <stop offset="35%" stopColor="#FFD54F"/>
            <stop offset="65%" stopColor="#D4AC0D"/>
            <stop offset="100%" stopColor="#FFD54F"/>
          </linearGradient>
          <linearGradient id="bl_arrowG" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#D4AC0D"/>
            <stop offset="100%" stopColor="#FFE082"/>
          </linearGradient>
          <linearGradient id="bl_ring" x1="0.5" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#5B9FDE"/>
            <stop offset="100%" stopColor="#3EBF8A"/>
          </linearGradient>
          <filter id="bl_glow">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="bl_goldGlow">
            <feGaussianBlur stdDeviation="4" result="b"/>
            <feFlood floodColor="#D4AC0D" floodOpacity="0.4" result="c"/>
            <feComposite in="c" in2="b" operator="in" result="d"/>
            <feMerge><feMergeNode in="d"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <clipPath id="bl_clip"><circle cx="100" cy="100" r="86"/></clipPath>
        </defs>

        {/* Solid dark background circle */}
        <circle cx="100" cy="100" r="92" fill="#091833"/>

        {/* Outer ring — bright gradient */}
        <circle cx="100" cy="100" r="90" fill="none" stroke="url(#bl_ring)" strokeWidth="2.5" opacity="0.7"/>
        <circle cx="100" cy="100" r="87" fill="none" stroke="url(#bl_ring)" strokeWidth="0.8" opacity="0.4"/>

        {/* Globe interior */}
        <g clipPath="url(#bl_clip)">
          <circle cx="100" cy="100" r="86" fill="#0A1E40"/>

          {/* ── MESH: Bold triangular network ── */}
          {/* Top tier — bright blue */}
          <polygon points="100,12 72,52 128,52" fill="rgba(74,148,220,0.08)" stroke="#5BA3E8" strokeWidth="2" />
          <polygon points="72,52 40,88 100,88" fill="rgba(74,148,220,0.06)" stroke="#5BA3E8" strokeWidth="1.8" />
          <polygon points="128,52 160,88 100,88" fill="rgba(74,148,220,0.06)" stroke="#5BA3E8" strokeWidth="1.8" />
          <polygon points="72,52 100,12 50,28" fill="rgba(74,148,220,0.04)" stroke="#4A90D9" strokeWidth="1.5" opacity="0.7"/>
          <polygon points="128,52 100,12 150,28" fill="rgba(74,148,220,0.04)" stroke="#4A90D9" strokeWidth="1.5" opacity="0.7"/>
          <polygon points="160,88 178,58 155,40" fill="rgba(74,148,220,0.03)" stroke="#4A90D9" strokeWidth="1.3" opacity="0.6"/>
          <polygon points="40,88 22,58 45,40" fill="rgba(74,148,220,0.03)" stroke="#4A90D9" strokeWidth="1.3" opacity="0.6"/>

          {/* Mid tier — teal transition */}
          <polygon points="22,105 40,88 32,125" fill="rgba(58,175,169,0.06)" stroke="#4DC9B0" strokeWidth="1.8" />
          <polygon points="178,105 160,88 168,125" fill="rgba(58,175,169,0.06)" stroke="#4DC9B0" strokeWidth="1.8" />
          <polygon points="40,88 32,125 68,118" fill="rgba(58,175,169,0.04)" stroke="#3FBFA5" strokeWidth="1.5" opacity="0.7"/>
          <polygon points="160,88 168,125 132,118" fill="rgba(58,175,169,0.04)" stroke="#3FBFA5" strokeWidth="1.5" opacity="0.7"/>

          {/* Lower tier — green */}
          <polygon points="32,125 22,155 60,148" fill="rgba(46,204,113,0.06)" stroke="#4CD990" strokeWidth="1.8" />
          <polygon points="168,125 178,155 140,148" fill="rgba(46,204,113,0.06)" stroke="#4CD990" strokeWidth="1.8" />
          <polygon points="60,148 42,172 88,168" fill="rgba(46,204,113,0.05)" stroke="#3ECF7F" strokeWidth="1.5" />
          <polygon points="140,148 158,172 112,168" fill="rgba(46,204,113,0.05)" stroke="#3ECF7F" strokeWidth="1.5" />

          {/* Bottom tier */}
          <polygon points="88,168 112,168 100,190" fill="rgba(39,174,96,0.05)" stroke="#34C474" strokeWidth="1.3" opacity="0.8"/>
          <polygon points="42,172 70,188 88,168" fill="rgba(39,174,96,0.04)" stroke="#2EBB68" strokeWidth="1.2" opacity="0.6"/>
          <polygon points="158,172 130,188 112,168" fill="rgba(39,174,96,0.04)" stroke="#2EBB68" strokeWidth="1.2" opacity="0.6"/>

          {/* ── GOLD ARROWS — growth indicators ── */}
          {/* Top arrow (prominent) */}
          <polygon points="100,8 90,30 110,30" fill="url(#bl_arrowG)" opacity="1"/>
          <polygon points="100,4 86,34 114,34" fill="none" stroke="#FFD54F" strokeWidth="1.5" opacity="0.5"/>

          {/* Upper-right arrow */}
          <line x1="158" y1="42" x2="175" y2="22" stroke="#FFD54F" strokeWidth="2.5" opacity="0.8"/>
          <polygon points="175,22 164,28 172,35" fill="#FFD54F" opacity="0.9"/>

          {/* Upper-left arrow */}
          <line x1="42" y1="42" x2="25" y2="22" stroke="#FFD54F" strokeWidth="2" opacity="0.6"/>
          <polygon points="25,22 36,28 28,35" fill="#FFD54F" opacity="0.7"/>

          {/* Right-side small arrow */}
          <polygon points="182,105 172,92 185,96" fill="url(#bl_arrowG)" opacity="0.7"/>
        </g>

        {/* Gold "12" — large, bold, glowing */}
        <text x="100" y="120" textAnchor="middle"
              fontFamily="'SF Pro Display','Helvetica Neue',Arial,sans-serif"
              fontSize="78" fontWeight="900" fill="url(#bl_gold)" filter="url(#bl_goldGlow)"
              letterSpacing="-2" stroke="#D4AC0D" strokeWidth="0.5">12</text>
      </svg>

      {showText && (
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: textSize, fontWeight: 800, letterSpacing: "0.15em",
            background: "linear-gradient(135deg, #FFE082, #D4AC0D, #FFD54F)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            fontFamily: "'SF Pro Display','Helvetica Neue',Arial,sans-serif",
          }}>12 TRIBES</div>
          <div style={{
            fontSize: subtitleSize, fontWeight: 600, letterSpacing: "0.25em",
            color: "#7BA3CC", marginTop: 4, textTransform: "uppercase",
            fontFamily: "'SF Pro Display','Helvetica Neue',Arial,sans-serif",
          }}>AI Investment Group</div>
        </div>
      )}
    </div>
  );
}
