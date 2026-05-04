// App Store style hero screenshots: 1290 x 2796 (6.7" iPhone).
// Each artboard = one App Store screenshot slot.

const AS_W = 1290;
const AS_H = 2796;

// --- Variation A: Bold headline above, deep green ---
const AppStoreHeroA = ({ src, eyebrow, title, accent }) => (
  <div style={{
    width: AS_W, height: AS_H,
    background: "#0e3d28",
    color: "#fff",
    padding: "120px 80px 0",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", flexDirection: "column", alignItems: "center",
    overflow: "hidden",
    position: "relative",
  }}>
    <div style={{
      position: "absolute", inset: 0, opacity: 0.4,
      background: "radial-gradient(ellipse 70% 60% at 50% -10%, #2a8e5c 0%, transparent 60%)",
    }} />
    <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "0.3em", color: "#7ed4a3", textTransform: "uppercase", marginBottom: 36, position: "relative" }}>
      {eyebrow}
    </div>
    <div style={{
      fontSize: 130, fontWeight: 800, lineHeight: 0.95,
      textAlign: "center", letterSpacing: "-0.04em",
      maxWidth: 1100, marginBottom: 80, position: "relative",
      textWrap: "balance",
    }}>
      {title}
      {accent && <span style={{ color: "#7ed4a3" }}>{accent}</span>}
    </div>
    <div style={{ position: "relative", filter: "drop-shadow(0 60px 120px rgba(0,0,0,0.5))" }}>
      <PhoneFrame src={src} width={900} shadow={false} />
    </div>
  </div>
);

// --- Variation B: Light, headline below, off-white ---
const AppStoreHeroB = ({ src, title, accent, subtitle }) => (
  <div style={{
    width: AS_W, height: AS_H,
    background: "#f1efe9",
    color: "#0e1a14",
    padding: "100px 80px 140px",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
    overflow: "hidden",
  }}>
    <div style={{ filter: "drop-shadow(0 40px 80px rgba(14,61,40,0.18))" }}>
      <PhoneFrame src={src} width={920} />
    </div>
    <div style={{ textAlign: "center", maxWidth: 1100 }}>
      <div style={{
        fontSize: 120, fontWeight: 800, lineHeight: 0.96,
        letterSpacing: "-0.04em",
        textWrap: "balance",
      }}>
        {title}
        {accent && <span style={{ color: "#0e3d28" }}> {accent}</span>}
      </div>
      {subtitle && <div style={{ fontSize: 38, marginTop: 32, color: "#5a665e", fontWeight: 500 }}>{subtitle}</div>}
    </div>
  </div>
);

// --- Variation C: Annotated feature with callouts ---
const AppStoreHeroC = ({ src, title, callouts = [] }) => (
  <div style={{
    width: AS_W, height: AS_H,
    background: "linear-gradient(180deg, #f7f5f0 0%, #e8e4d9 100%)",
    color: "#0e1a14",
    padding: "100px 60px",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", flexDirection: "column", alignItems: "center",
    overflow: "hidden",
    position: "relative",
  }}>
    <div style={{
      fontSize: 110, fontWeight: 800, lineHeight: 0.96,
      letterSpacing: "-0.04em", textAlign: "center", maxWidth: 1100,
      marginBottom: 60, textWrap: "balance",
    }}>
      {title}
    </div>
    <div style={{ position: "relative", filter: "drop-shadow(0 40px 80px rgba(0,0,0,0.18))" }}>
      <PhoneFrame src={src} width={820} />
      {callouts.map((c, i) => (
        <div key={i} style={{
          position: "absolute",
          ...c.position,
          background: "#0e3d28",
          color: "#fff",
          padding: "20px 28px",
          borderRadius: 18,
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.3,
          maxWidth: 320,
          boxShadow: "0 20px 40px rgba(14,61,40,0.3)",
        }}>
          {c.label}
          <div style={{
            position: "absolute",
            ...c.tail,
            width: 24, height: 24,
            background: "#0e3d28",
            transform: "rotate(45deg)",
          }} />
        </div>
      ))}
    </div>
  </div>
);

// --- Variation D: Dark editorial with serif accent ---
const AppStoreHeroD = ({ src, eyebrow, italicTitle, restTitle, subtitle }) => (
  <div style={{
    width: AS_W, height: AS_H,
    background: "#0a0e0c",
    color: "#fff",
    padding: "120px 80px 0",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", flexDirection: "column", alignItems: "center",
    overflow: "hidden",
    position: "relative",
  }}>
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 600,
      background: "radial-gradient(ellipse at 50% 0%, rgba(255,107,53,0.25) 0%, transparent 70%)",
    }} />
    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.4em", color: "#ff6b35", textTransform: "uppercase", marginBottom: 40, position: "relative" }}>
      {eyebrow}
    </div>
    <div style={{
      fontSize: 130, fontWeight: 700, lineHeight: 0.96,
      textAlign: "center", letterSpacing: "-0.03em",
      maxWidth: 1100, marginBottom: 70, position: "relative",
      fontFamily: '"Instrument Serif", "Times New Roman", serif',
    }}>
      <em style={{ color: "#ff6b35" }}>{italicTitle}</em><br />
      {restTitle}
    </div>
    {subtitle && (
      <div style={{ fontSize: 32, color: "#9aa39d", marginBottom: 70, textAlign: "center", maxWidth: 900, fontWeight: 400 }}>
        {subtitle}
      </div>
    )}
    <div style={{ filter: "drop-shadow(0 60px 120px rgba(255,107,53,0.2))" }}>
      <PhoneFrame src={src} width={900} bezelColor="#1a1a1a" />
    </div>
  </div>
);

// --- Variation E: Stat / proof layout ---
const AppStoreHeroE = ({ src, stat, statLabel, headline, sub }) => (
  <div style={{
    width: AS_W, height: AS_H,
    background: "#0e3d28",
    color: "#fff",
    padding: "120px 80px",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
    overflow: "hidden",
  }}>
    <div style={{ textAlign: "center" }}>
      <div style={{
        fontSize: 280, fontWeight: 800, lineHeight: 0.9,
        letterSpacing: "-0.06em", color: "#7ed4a3",
      }}>
        {stat}
      </div>
      <div style={{ fontSize: 36, fontWeight: 600, color: "#fff", textTransform: "uppercase", letterSpacing: "0.3em", marginTop: 20 }}>
        {statLabel}
      </div>
      <div style={{ fontSize: 64, fontWeight: 700, marginTop: 60, lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: 1000, textWrap: "balance" }}>
        {headline}
      </div>
      {sub && <div style={{ fontSize: 32, color: "rgba(255,255,255,0.7)", marginTop: 24, fontWeight: 400 }}>{sub}</div>}
    </div>
    <div style={{ filter: "drop-shadow(0 60px 100px rgba(0,0,0,0.5))" }}>
      <PhoneFrame src={src} width={780} />
    </div>
  </div>
);

window.AppStoreHeroA = AppStoreHeroA;
window.AppStoreHeroB = AppStoreHeroB;
window.AppStoreHeroC = AppStoreHeroC;
window.AppStoreHeroD = AppStoreHeroD;
window.AppStoreHeroE = AppStoreHeroE;
