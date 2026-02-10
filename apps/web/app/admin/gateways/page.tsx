'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { listGateways, updateGateway, type AdminGateway } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

export default function AdminGatewaysPage() {
  const { getToken } = useAuth();
  const [gateways, setGateways] = useState<AdminGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setGateways(await listGateways(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (gw: AdminGateway) => {
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updateGateway(token, gw.id, { isActive: !gw.isActive });
      setGateways((prev) => prev.map((g) => (g.id === gw.id ? updated : g)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  // Group by region
  const grouped = gateways.reduce(
    (acc, gw) => {
      const region = gw.region || 'GLOBAL';
      if (!acc[region]) acc[region] = [];
      acc[region].push(gw);
      return acc;
    },
    {} as Record<string, AdminGateway[]>,
  );

  if (loading) return <div className={styles.loading}>Loading gateways...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Payment Gateways</h1>
      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {Object.entries(grouped).map(([region, regionGateways]) => (
        <div key={region} className={pageStyles.regionGroup}>
          <h2 className={pageStyles.regionTitle}>{region}</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {regionGateways.map((gw) => (
                <tr key={gw.id}>
                  <td style={{ fontWeight: 500 }}>{gw.provider}</td>
                  <td>
                    <button
                      className={`${styles.toggle} ${gw.isActive ? styles.toggleOn : styles.toggleOff}`}
                      onClick={() => handleToggle(gw)}
                      aria-label={gw.isActive ? 'Deactivate' : 'Activate'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
