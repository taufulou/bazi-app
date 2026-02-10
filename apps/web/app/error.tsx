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
        background: '#1a1a2e',
        color: '#e0e0e0',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <h1 style={{ fontSize: 48, color: '#e8d5b7', marginBottom: 16 }}>Oops</h1>
        <p style={{ fontSize: 16, color: '#a0a0a0', marginBottom: 24 }}>
          Something went wrong. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '12px 24px',
            background: '#e8d5b7',
            color: '#1a1a2e',
            border: 'none',
            borderRadius: 8,
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
