export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1a1a2e',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* Header skeleton */}
        <div
          style={{
            height: 32,
            width: 200,
            background: '#16213e',
            borderRadius: 8,
            marginBottom: 32,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />

        {/* Reading cards grid skeleton */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 20,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: '#16213e',
                borderRadius: 12,
                padding: 24,
                height: 160,
                animation: 'pulse 1.5s ease-in-out infinite',
                animationDelay: `${i * 0.1}s`,
              }}
            >
              <div
                style={{
                  height: 20,
                  width: '60%',
                  background: '#1a1a2e',
                  borderRadius: 4,
                  marginBottom: 12,
                }}
              />
              <div
                style={{
                  height: 14,
                  width: '80%',
                  background: '#1a1a2e',
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  height: 14,
                  width: '40%',
                  background: '#1a1a2e',
                  borderRadius: 4,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
