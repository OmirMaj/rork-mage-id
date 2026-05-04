// Social and landing-page hero compositions.

// --- Landing hero: 16:9 (1920x1080) wide composition with 3 stacked phones ---
const LandingHero3Phone = ({ srcs = [], title, accent, subtitle, cta }) => (
  <div style={{
    width: 1920, height: 1080,
    background: "#f1efe9",
    color: "#0e1a14",
    padding: "0 120px",
    boxSizing: "border-box",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    display: "flex", alignItems: "center", justifyContent: "space-between",
    overflow: "hidden",
    position: "relative",
  }}>
    <div style={{ maxWidth: 800, position: "relative", zIndex: 2 }}>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "#0e3d28", marginBottom: 32 }}>
        MAGE ID
      </div>
      <h1 style={{
        fontSize: 96, fontWeight: 800, lineHeight: 0.96,
        letterSpacing: "-0.04em", margin: 0,
        textWrap: "balance",
      }}>
        {title} <span style={{ color: "#0e3d28" }}>{accent}</span>
      </h1>
      <p style={{ fontSize: 26, color: "#5a665e", marginTop: 36, lineHeight: 1.4, maxWidth: 640 }}>
        {subtitle}
      </p>
      {cta && (
        <div style={{ marginTop: 48, display: "flex", gap: 16 }}>
          <div style={{
            background: "#0e3d28", color: "#fff",
            padding: "20px 36px", borderRadius: 999,
            fontSize: 22, fontWeight: 600,
          }}>{cta}</div>
          <div style={{
            border: "1.5px solid #0e3d28", color: "#0e3d28",
            padding: "20px 36px", borderRadius: 999,
            fontSize: 22, fontWeight: 600,
          }}>See pricing</div>
        </div>
      )}
    </div>
    <div style={{
      position: "relative",
      width: 800, height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ position: "absolute", left: 40, top: 130, transform: "rotate(-8deg)", filter: "drop-shadow(0 30px 60px rgba(14,61,40,0.18))" }}>
        <PhoneFrame src={srcs[0]} width={300} shadow={false} />
      </div>
      <div style={{ position: "absolute", right: 40, top: 60, transform: "rotate(6deg)", filter: "drop-shadow(0 40px 80px rgba(14,61,40,0.22))" }}>
        <PhoneFrame src={srcs[2]} width={300} shadow={false} />
      </div>
      <div style={{ position: "relative", zIndex: 3, filter: "drop-shadow(0 50px 100px rgba(14,61,40,0.25))" }}>
        <PhoneFrame src={srcs[1]} width={360} shadow={false} />
      </div>
    </div>
  </div>
);

// --- Social square 1080x1080 with single phone + headline ---
const SocialSquare = ({ src, title, accent, tag, bg = "#0e3d28", fg = "#fff", accentColor = "#7ed4a3" }) => (
  <div style={{
    width: 1080, height: 1080,
    background: bg, color: fg,
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    padding: 70, boxSizing: "border-box",
    display: "flex", flexDirection: "column", justifyContent: "space-between",
    position: "relative", overflow: "hidden",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "0.3em", textTransform: "uppercase", color: accentColor }}>
        MAGE ID
      </div>
      {tag && (
        <div style={{
          border: `1.5px solid ${accentColor}`, color: accentColor,
          padding: "8px 18px", borderRadius: 999, fontSize: 16, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase"
        }}>{tag}</div>
      )}
    </div>
    <div style={{
      display: "flex", alignItems: "center", gap: 50,
      flex: 1, marginTop: 40,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 84, fontWeight: 800, lineHeight: 0.95,
          letterSpacing: "-0.04em",
          textWrap: "balance",
        }}>
          {title}
          {accent && <><br /><span style={{ color: accentColor }}>{accent}</span></>}
        </div>
      </div>
      <div style={{ flexShrink: 0, filter: "drop-shadow(0 30px 60px rgba(0,0,0,0.4))" }}>
        <PhoneFrame src={src} width={340} shadow={false} />
      </div>
    </div>
  </div>
);

// --- Story 1080x1920 vertical ---
const SocialStory = ({ src, title, accent, sub, bg = "#f1efe9", fg = "#0e1a14", accentColor = "#0e3d28" }) => (
  <div style={{
    width: 1080, height: 1920,
    background: bg, color: fg,
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    padding: "120px 70px", boxSizing: "border-box",
    display: "flex", flexDirection: "column", alignItems: "center",
    position: "relative", overflow: "hidden",
  }}>
    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.4em", textTransform: "uppercase", color: accentColor, marginBottom: 60 }}>
      MAGE ID
    </div>
    <div style={{
      fontSize: 110, fontWeight: 800, lineHeight: 0.95,
      letterSpacing: "-0.04em", textAlign: "center",
      textWrap: "balance", marginBottom: 30,
    }}>
      {title}
    </div>
    {accent && (
      <div style={{
        fontSize: 110, fontWeight: 800, lineHeight: 0.95, letterSpacing: "-0.04em",
        textAlign: "center", color: accentColor, marginBottom: 40,
        fontFamily: '"Instrument Serif", serif', fontStyle: "italic",
      }}>
        {accent}
      </div>
    )}
    {sub && <div style={{ fontSize: 30, color: "#5a665e", textAlign: "center", maxWidth: 800, marginBottom: 60 }}>{sub}</div>}
    <div style={{ marginTop: "auto", filter: "drop-shadow(0 50px 100px rgba(14,61,40,0.25))" }}>
      <PhoneFrame src={src} width={680} />
    </div>
  </div>
);

// --- Twitter card 1600x900 ---
const TwitterCard = ({ srcs = [], title, sub }) => (
  <div style={{
    width: 1600, height: 900,
    background: "#0a0e0c", color: "#fff",
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    padding: 80, boxSizing: "border-box",
    display: "flex", alignItems: "center", gap: 80,
    position: "relative", overflow: "hidden",
  }}>
    <div style={{
      position: "absolute", inset: 0, opacity: 0.6,
      background: "radial-gradient(ellipse 50% 70% at 100% 50%, rgba(255,107,53,0.22) 0%, transparent 60%)",
    }} />
    <div style={{ flex: 1, position: "relative" }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.4em", color: "#ff6b35", textTransform: "uppercase", marginBottom: 32 }}>
        MAGE ID — for general contractors
      </div>
      <div style={{
        fontSize: 86, fontWeight: 700, lineHeight: 0.98,
        letterSpacing: "-0.035em",
        fontFamily: '"Instrument Serif", serif',
      }}>
        {title}
      </div>
      <div style={{ fontSize: 24, color: "#9aa39d", marginTop: 36, lineHeight: 1.5, maxWidth: 600 }}>
        {sub}
      </div>
    </div>
    <div style={{ position: "relative", width: 520, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", left: -20, top: 80, transform: "rotate(-7deg)", opacity: 0.85 }}>
        <PhoneFrame src={srcs[0]} width={260} bezelColor="#1a1a1a" />
      </div>
      <div style={{ position: "relative", zIndex: 2 }}>
        <PhoneFrame src={srcs[1]} width={300} bezelColor="#1a1a1a" />
      </div>
    </div>
  </div>
);

window.LandingHero3Phone = LandingHero3Phone;
window.SocialSquare = SocialSquare;
window.SocialStory = SocialStory;
window.TwitterCard = TwitterCard;
