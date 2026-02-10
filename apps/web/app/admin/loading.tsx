export default function AdminLoading() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar skeleton */}
      <div
        style={{
          width: 240,
          background: '#0f0f23',
          padding: '20px 0',
          borderRight: '1px solid rgba(232, 213, 183, 0.1)',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div
          style={{
            height: 24,
            width: 140,
            background: '#16213e',
            borderRadius: 4,
            margin: '0 16px 24px',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />

        {/* Nav items */}
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 36,
              margin: '4px 12px',
              background: '#16213e',
              borderRadius: 6,
              animation: 'pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.05}s`,
            }}
          />
        ))}
      </div>

      {/* Content skeleton */}
      <div style={{ flex: 1, padding: 32, background: '#1a1a2e' }}>
        {/* Title */}
        <div
          style={{
            height: 28,
            width: 200,
            background: '#16213e',
            borderRadius: 6,
            marginBottom: 24,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />

        {/* Stat cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            marginBottom: 32,
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 100,
                background: '#16213e',
                borderRadius: 8,
                animation: 'pulse 1.5s ease-in-out infinite',
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>

        {/* Table skeleton */}
        <div
          style={{
            background: '#16213e',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 48,
                borderBottom: '1px solid rgba(232, 213, 183, 0.05)',
                animation: 'pulse 1.5s ease-in-out infinite',
                animationDelay: `${i * 0.08}s`,
              }}
            />
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
