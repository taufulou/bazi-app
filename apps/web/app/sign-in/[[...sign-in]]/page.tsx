import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        backgroundColor: "#1a1a2e",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            color: "#e8d5b7",
            fontSize: "2rem",
            marginBottom: "0.5rem",
            fontWeight: 700,
          }}
        >
          八字命理平台
        </h1>
        <p
          style={{
            color: "#a0a0a0",
            fontSize: "1rem",
            marginBottom: "2rem",
          }}
        >
          AI 驅動的八字命理分析
        </p>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
            },
          }}
        />
      </div>
    </div>
  );
}
