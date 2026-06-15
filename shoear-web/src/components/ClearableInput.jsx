// A text input with an Instagram-style clear (✕) button on the right that
// appears only when there's text and empties the field in one click — so users
// don't have to hold backspace. Pass the usual input props (name, type, value,
// onChange, onBlur, placeholder, className) plus an onClear handler.
function ClearableInput({ value, onClear, className = '', style, ...props }) {
  return (
    <div className="position-relative">
      <input
        {...props}
        value={value}
        className={`form-control ${className}`}
        // leave room for the button + drop Bootstrap's validation icon so the
        // two don't overlap (the red border + message still convey errors)
        style={{ paddingRight: '3rem', backgroundImage: 'none', ...style }}
      />
      {value && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}   // don't steal focus on click
          onClick={onClear}
          className="btn position-absolute top-50 end-0 translate-middle-y p-1 me-1 d-flex align-items-center text-secondary border-0"
          style={{ lineHeight: 1, background: 'none' }}
        >
          <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default ClearableInput;
