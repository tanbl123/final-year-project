// A tiny dependency-free bar chart for the dashboards' sales trend. Renders the
// already zero-filled, ordered [{date,gross}] series the backend returns (which
// spans the selected period), one SVG bar per day with a native hover tooltip.

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesTrendChart({ data = [], color = '#4f46e5', height = 140 }) {
  const points = data || [];
  const total = points.reduce((s, p) => s + (Number(p.gross) || 0), 0);

  if (!points.length || total === 0) {
    return <div className="text-muted small py-4 text-center">No sales in this period.</div>;
  }

  const max = Math.max(1, ...points.map((p) => Number(p.gross) || 0));
  const H = 48;
  const W = points.length * 12;
  const bw = W / points.length;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {points.map((p, i) => {
          const g = Number(p.gross) || 0;
          const h = (g / max) * (H - 2);
          return (
            <rect
              key={p.date}
              x={i * bw + 0.6}
              y={H - h}
              width={bw - 1.2}
              height={h}
              fill={g > 0 ? color : '#e5e7eb'}
              rx="0.6"
            >
              <title>{`${p.date}: ${rm(g)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="d-flex justify-content-between text-muted" style={{ fontSize: 11 }}>
        <span>{points[0].date}</span>
        <span>Total: {rm(total)}</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  );
}
