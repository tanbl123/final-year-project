// A tiny dependency-free bar chart for the dashboards' sales trend. Takes the
// API's sparse [{date,gross}] list, fills the last `days` days with zeros, and
// renders SVG bars (each with a native hover tooltip). Stretches to its width.

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SalesTrendChart({ data = [], days = 14, color = '#4f46e5', height = 140 }) {
  const map = new Map((data || []).map((d) => [d.date, Number(d.gross) || 0]));
  const today = new Date();
  const points = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = iso(d);
    points.push({ date: key, gross: map.get(key) || 0 });
  }

  const max = Math.max(1, ...points.map((p) => p.gross));
  const total = points.reduce((s, p) => s + p.gross, 0);
  const W = points.length * 12;
  const H = 48;
  const bw = W / points.length;

  if (total === 0) {
    return <div className="text-muted small py-4 text-center">No sales in the last {days} days.</div>;
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {points.map((p, i) => {
          const h = (p.gross / max) * (H - 2);
          return (
            <rect
              key={p.date}
              x={i * bw + 0.6}
              y={H - h}
              width={bw - 1.2}
              height={h}
              fill={p.gross > 0 ? color : '#e5e7eb'}
              rx="0.6"
            >
              <title>{`${p.date}: ${rm(p.gross)}`}</title>
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
