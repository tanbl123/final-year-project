// Shared "Virtual try-on / AR" filter used by the supplier and admin product
// lists. A product is in one of three AR states, derived from two flags the
// list endpoints return:
//   • virtualTryOnEnable — the supplier turned try-on on for this product
//   • arReady            — a live Camera Kit lens is recorded (customers can try it)
//
//   ready   → try-on on AND a lens is live         (AR actually works)
//   enabled → try-on on but NO lens yet            (queued for AR prep)
//   off     → try-on turned off                    (no AR)

// Dropdown options ('' = no filter). Kept in one place so both pages match.
export const AR_FILTER_OPTIONS = [
  { value: '', label: 'All try-on' },
  { value: 'ready', label: 'AR-ready (lens live)' },
  { value: 'enabled', label: 'Try-on on, no lens yet' },
  { value: 'off', label: 'Try-on off' },
];

// True if the product matches the selected AR filter. `''`/unknown → matches all.
export function matchesArFilter(p, ar) {
  const enabled = !!p.virtualTryOnEnable;
  const ready = !!p.arReady;
  switch (ar) {
    case 'ready':   return enabled && ready;
    case 'enabled': return enabled && !ready;
    case 'off':     return !enabled;
    default:        return true;
  }
}
