import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1a1a2e",
        color: "#e0e0e0",
        padding: "2rem",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "3rem",
          paddingBottom: "1rem",
          borderBottom: "1px solid rgba(232, 213, 183, 0.2)",
        }}
      >
        <h1 style={{ color: "#e8d5b7", fontSize: "1.5rem", fontWeight: 700 }}>
          八字命理平台
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ color: "#a0a0a0", fontSize: "0.9rem" }}>
            {user.firstName || user.emailAddresses[0]?.emailAddress || "用戶"}
          </span>
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "w-10 h-10",
              },
            }}
          />
        </div>
      </header>

      {/* Welcome Section */}
      <section style={{ marginBottom: "3rem" }}>
        <h2
          style={{
            color: "#e8d5b7",
            fontSize: "1.8rem",
            marginBottom: "0.5rem",
          }}
        >
          歡迎回來
          {user.firstName ? `，${user.firstName}` : ""}
        </h2>
        <p style={{ color: "#a0a0a0" }}>選擇一項服務開始您的命理之旅</p>
      </section>

      {/* Reading Types Grid */}
      <section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {readingTypes.map((reading) => (
            <Link
              key={reading.slug}
              href={`/reading/${reading.slug}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  backgroundColor: "#16213e",
                  borderRadius: "12px",
                  padding: "1.5rem",
                  border: "1px solid rgba(232, 213, 183, 0.1)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  height: "100%",
                }}
              >
                <div
                  style={{
                    fontSize: "2rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  {reading.icon}
                </div>
                <h3
                  style={{
                    color: "#e8d5b7",
                    fontSize: "1.2rem",
                    marginBottom: "0.5rem",
                    fontWeight: 600,
                  }}
                >
                  {reading.name}
                </h3>
                <p
                  style={{
                    color: "#a0a0a0",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                  }}
                >
                  {reading.description}
                </p>
                <div
                  style={{
                    marginTop: "1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      color: "#e8d5b7",
                      fontSize: "0.85rem",
                      opacity: 0.7,
                    }}
                  >
                    {reading.credits} 點數
                  </span>
                  <span
                    style={{
                      color: "#e8d5b7",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                    }}
                  >
                    開始分析 &rarr;
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

const readingTypes = [
  {
    slug: "lifetime",
    icon: "🌟",
    name: "八字終身運",
    description: "全面分析您的八字命盤，深入了解一生的命運走向",
    credits: 2,
  },
  {
    slug: "annual",
    icon: "📅",
    name: "八字流年運勢",
    description: "預測您今年的運勢變化，掌握每月吉凶",
    credits: 2,
  },
  {
    slug: "career",
    icon: "💼",
    name: "事業財運",
    description: "分析事業發展方向與財運走勢，找到最佳機遇",
    credits: 2,
  },
  {
    slug: "love",
    icon: "💕",
    name: "愛情姻緣",
    description: "探索感情運勢，了解理想伴侶特質與姻緣時機",
    credits: 2,
  },
  {
    slug: "health",
    icon: "🏥",
    name: "先天健康分析",
    description: "根據五行分析先天體質，提供養生保健建議",
    credits: 2,
  },
  {
    slug: "compatibility",
    icon: "🤝",
    name: "合盤比較",
    description: "比較兩人八字，分析感情或事業合作的契合度",
    credits: 3,
  },
];
