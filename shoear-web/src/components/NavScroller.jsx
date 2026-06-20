import { useRef, useState, useEffect, useCallback } from 'react';

// A horizontally-scrollable row (used for the navbar links). When the content
// overflows it shows ‹ › arrow buttons, so it's obvious there's more to scroll —
// the left arrow hides at the start, the right arrow hides at the end.
function NavScroller({ children }) {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflow(max > 1);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro.disconnect();
    };
  }, [update]);

  function scroll(dir) {
    ref.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  }

  const arrow = (dir, hidden) => (
    <button type="button"
      className="btn btn-link text-light text-decoration-none px-2 flex-shrink-0 fs-4 lh-1"
      style={{ visibility: hidden ? 'hidden' : 'visible' }}
      onClick={() => scroll(dir)} aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}>
      {dir < 0 ? '‹' : '›'}
    </button>
  );

  return (
    <div className="d-flex align-items-center flex-grow-1" style={{ minWidth: 0 }}>
      {overflow && arrow(-1, atStart)}
      <div ref={ref} className="navbar-nav flex-row flex-nowrap nav-scroller" style={{ minWidth: 0 }}>
        {children}
      </div>
      {overflow && arrow(1, atEnd)}
    </div>
  );
}

export default NavScroller;
