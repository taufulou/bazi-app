import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1a1a2e',
        color: '#e0e0e0',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <h1 style={{ fontSize: 72, color: '#e8d5b7', marginBottom: 8, fontWeight: 700 }}>404</h1>
        <p style={{ fontSize: 18, color: '#a0a0a0', marginBottom: 32 }}>
          Page not found
        </p>
        <Link
          href="/dashboard"
          style={{
            padding: '12px 24px',
            background: '#e8d5b7',
            color: '#1a1a2e',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
