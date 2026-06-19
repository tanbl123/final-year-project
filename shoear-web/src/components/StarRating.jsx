// Read-only star display for a 1–5 rating score.
function StarRating({ score, size = '1rem' }) {
  const full = Math.round(Number(score) || 0);
  return (
    <span title={`${score} / 5`} style={{ color: '#f5a623', fontSize: size, letterSpacing: '1px' }}>
      {'★'.repeat(full)}
      <span style={{ color: '#d0d0d0' }}>{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export default StarRating;
