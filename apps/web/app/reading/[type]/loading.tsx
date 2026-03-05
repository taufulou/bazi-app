export default function ReadingLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#FFF3E0',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Step indicator skeleton */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 16,
            marginBottom: 40,
          }}
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 32,
                width: 120,
                background: 'rgba(212, 160, 23, 0.12)',
                borderRadius: 16,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>

        {/* Form skeleton */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: 32,
            border: '1px solid rgba(212, 160, 23, 0.15)',
            boxShadow: '0 4px 20px rgba(226, 61, 40, 0.08)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          {/* Title */}
          <div
            style={{
              height: 24,
              width: '40%',
              background: 'rgba(212, 160, 23, 0.1)',
              borderRadius: 4,
              marginBottom: 24,
            }}
          />

          {/* Form fields */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <div
                style={{
                  height: 14,
                  width: 80,
                  background: 'rgba(212, 160, 23, 0.1)',
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  height: 40,
                  width: '100%',
                  background: 'rgba(212, 160, 23, 0.06)',
                  borderRadius: 8,
                }}
              />
            </div>
          ))}

          {/* Submit button */}
          <div
            style={{
              height: 44,
              width: 160,
              background: 'rgba(226, 61, 40, 0.12)',
              borderRadius: 12,
              marginTop: 12,
            }}
          />
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
