import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * Server-side OG image for compatibility sharing.
 * URL pattern: /api/og/compatibility/[score]/[label]
 * e.g., /api/og/compatibility/72/天生一對
 *
 * Score + label are encoded in URL path — no DB lookup needed.
 * No birth data exposed (privacy safe).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ score: string; label: string }> },
) {
  const { score: scoreStr, label: labelEncoded } = await params;
  const score = Math.min(100, Math.max(0, parseInt(scoreStr) || 0));
  const label = decodeURIComponent(labelEncoded);

  // Score color mapping
  let scoreColor = "#f44336";
  if (score >= 85) scoreColor = "#4caf50";
  else if (score >= 70) scoreColor = "#8bc34a";
  else if (score >= 55) scoreColor = "#ffc107";
  else if (score >= 40) scoreColor = "#ff9800";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top watermark */}
        <div
          style={{
            position: "absolute",
            top: "40px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "rgba(232, 213, 183, 0.4)",
            fontSize: "24px",
          }}
        >
          🤝 八字合盤分析
        </div>

        {/* Score */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "160px",
              fontWeight: 800,
              color: scoreColor,
              lineHeight: 1,
            }}
          >
            {score}
          </span>
          <span
            style={{
              fontSize: "40px",
              color: "rgba(232, 213, 183, 0.6)",
              fontWeight: 500,
            }}
          >
            分
          </span>
        </div>

        {/* Label */}
        <div
          style={{
            fontSize: "48px",
            fontWeight: 700,
            color: "#e8d5b7",
            marginTop: "16px",
          }}
        >
          {label}
        </div>

        {/* Bottom CTA */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "rgba(160, 160, 160, 0.6)",
            fontSize: "20px",
          }}
        >
          點擊查看完整合盤分析
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
