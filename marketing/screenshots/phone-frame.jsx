// Minimal iPhone 15 Pro frame for marketing screenshots.
// width is the OUTER frame width in px; everything scales from that.
// Aspect locked to 19.5:9 (430:932 = iPhone 15 Pro Max viewport).

const PhoneFrame = ({ src, width = 380, rotate = 0, shadow = true, bezelColor = "#0a0a0a", style = {}, hideStatusBar = false, children }) => {
  const aspect = 932 / 430; // height / width of viewport
  const bezel = Math.max(8, width * 0.028);
  const radius = width * 0.13;
  const innerRadius = radius - bezel * 0.7;
  const outerH = width * aspect + bezel * 2;
  const innerW = width - bezel * 2;
  const innerH = width * aspect;

  // Dynamic island: ~width*0.28 wide, ~bezel*1.6 tall, top-bezel away from top of inner
  const islandW = innerW * 0.32;
  const islandH = bezel * 1.4;
  const islandTop = bezel * 0.55;

  return (
    <div
      style={{
        width: `${width + bezel * 2}px`,
        height: `${outerH}px`,
        borderRadius: `${radius}px`,
        background: bezelColor,
        padding: `${bezel}px`,
        boxSizing: "border-box",
        position: "relative",
        transform: `rotate(${rotate}deg)`,
        boxShadow: shadow
          ? "0 40px 80px -20px rgba(0,0,0,0.35), 0 12px 24px -8px rgba(0,0,0,0.25), inset 0 0 0 1.5px rgba(255,255,255,0.06)"
          : "inset 0 0 0 1.5px rgba(255,255,255,0.06)",
        ...style,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: `${innerRadius}px`,
          overflow: "hidden",
          position: "relative",
          background: "#fff",
        }}
      >
        {src && (
          <img
            src={src}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top",
              display: "block",
            }}
          />
        )}
        {children}
        {/* Dynamic island */}
        <div
          style={{
            position: "absolute",
            top: `${islandTop}px`,
            left: "50%",
            transform: "translateX(-50%)",
            width: `${islandW}px`,
            height: `${islandH}px`,
            background: "#000",
            borderRadius: `${islandH}px`,
            zIndex: 5,
          }}
        />
      </div>
    </div>
  );
};

window.PhoneFrame = PhoneFrame;
