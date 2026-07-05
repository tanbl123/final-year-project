import { useEffect, useState } from 'react';
import { getPayoutStatus } from './payouts/payoutService';

// Whether the signed-in supplier is blocked from listing products because they
// haven't connected a Stripe payout account yet. Only blocks when Stripe is
// configured on the server; on a status error it never blocks (fail-open), so
// demo / no-Stripe setups keep working. Used to gate every "add product" entry.
export function usePayoutBlocked() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let active = true;
    getPayoutStatus()
      .then((s) => { if (active) setBlocked(!!s.configured && !s.payoutsEnabled); })
      .catch(() => { if (active) setBlocked(false); });
    return () => { active = false; };
  }, []);
  return blocked;
}
