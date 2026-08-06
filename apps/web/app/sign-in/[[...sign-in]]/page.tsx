import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
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
          預見你的一生
        </p>
        {/* No `appearance` here on purpose. It previously passed
            `elements: { rootBox: "mx-auto" }` — a TAILWIND class, in a project
            that has no Tailwind, so it did nothing; and a component-level
            `elements` risks shadowing the provider's. Typography and colour
            now come from `clerkAppearance` on the ClerkProvider in layout.tsx,
            in ONE place. */}
        <SignIn />
      </div>
    </div>
  );
}
