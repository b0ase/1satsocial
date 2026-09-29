import { ImageResponse } from "next/og";

export const alt = "1satsocial: every token is a room, only holders get in";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GOLD = "#e8b04a";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(circle at 85% 15%, #2a2210 0%, #09090b 55%)",
          color: "#ededf0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: GOLD,
              color: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            1
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
            1sat<span style={{ color: GOLD }}>social</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>Every token is a room.</div>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05, color: "#8b8b95" }}>
            Only holders get in.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 28, color: "#8b8b95" }}>
          <div style={{ display: "flex" }}>Holder-only chat for 1Sat Ordinals on BSV</div>
          <div
            style={{
              display: "flex",
              padding: "10px 22px",
              borderRadius: 999,
              border: `2px solid ${GOLD}`,
              color: GOLD,
            }}
          >
            Sign in with Yours Wallet
          </div>
        </div>
      </div>
    ),
    size,
  );
}
