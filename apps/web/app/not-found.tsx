import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#FFF3E0',
        color: '#3C2415',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <h1 style={{ fontSize: 72, color: '#C41E3A', marginBottom: 8, fontWeight: 700 }}>404</h1>
        <p style={{ fontSize: 18, color: '#6B5940', marginBottom: 32 }}>
          Page not found
        </p>
        <Link
          href="/"
          style={{
            padding: '12px 24px',
            background: '#E23D28',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 12,
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
