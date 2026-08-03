// A round avatar. When an image `url` is given (e.g. a supplier's approved
// company logo) it shows that; otherwise it falls back to the first initial on
// a colour picked deterministically from the name (Google-style), so the same
// person always gets the same colour.
const COLORS = [
  '#1abc9c', '#3498db', '#9b59b6', '#e67e22', '#e74c3c',
  '#16a085', '#2980b9', '#8e44ad', '#d35400', '#27ae60',
];

function Avatar({ name = '', size = 32, className = '', url = null }) {
  const trimmed = name.trim();
  const letter = (trimmed[0] || '?').toUpperCase();

  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = trimmed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const bg = COLORS[Math.abs(hash) % COLORS.length];

  if (url) {
    return (
      <img
        src={url}
        alt={trimmed || 'avatar'}
        className={'rounded-circle ' + className}
        style={{ width: size, height: size, objectFit: 'cover', flex: '0 0 auto', backgroundColor: '#f1f3f5' }}
      />
    );
  }

  return (
    <span
      className={'d-inline-flex align-items-center justify-content-center rounded-circle text-white fw-semibold ' + className}
      style={{
        width: size, height: size, backgroundColor: bg,
        fontSize: Math.round(size * 0.45), lineHeight: 1, flex: '0 0 auto', userSelect: 'none',
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

export default Avatar;
