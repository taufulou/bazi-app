'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

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
        <h1 style={{ fontSize: 48, color: '#C41E3A', marginBottom: 16 }}>Oops</h1>
        <p style={{ fontSize: 16, color: '#6B5940', marginBottom: 24 }}>
          Something went wrong. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '12px 24px',
            background: '#E23D28',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
