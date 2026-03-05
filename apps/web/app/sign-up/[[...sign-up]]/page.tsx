import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "linear-gradient(180deg, #FFF3E0 0%, #FFFBF5 100%)",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            color: "#C41E3A",
            fontSize: "2rem",
            marginBottom: "0.5rem",
            fontWeight: 700,
            fontFamily: "var(--font-noto-serif-tc), serif",
          }}
        >
          天命
        </h1>
        <p
          style={{
            color: "#6B5940",
            fontSize: "1rem",
            marginBottom: "2rem",
          }}
        >
          建立帳號，開始您的命理之旅
        </p>
        <SignUp
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
