'use client';

import { useEffect } from 'react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin error:', error);
  }, [error]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, color: '#e8d5b7', marginBottom: 12 }}>Admin Error</h2>
        <p style={{ fontSize: 14, color: '#a0a0a0', marginBottom: 20 }}>
          {error.message || 'Something went wrong in the admin panel.'}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '8px 20px',
            background: '#e8d5b7',
            color: '#1a1a2e',
            border: 'none',
            borderRadius: 6,
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
