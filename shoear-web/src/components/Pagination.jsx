// Numbered pager for client-side lists.
//   page, totalPages — usually straight from usePagination()
//   onChange         — receives the new page number
//   summary          — optional caption, e.g. "Page 1 of 3 · 24 users"
//
// Real e-commerce sites hide the page buttons when there's only one page but
// still show a result count (so the user knows the list is complete). We do the
// same: on a single page we show just the count part of the summary.
function Pagination({ page, totalPages, onChange, summary }) {
  if (totalPages <= 1) {
    if (!summary) return null;
    // keep only the "24 users" part, dropping a redundant "Page 1 of 1"
    const count = summary.includes('·') ? summary.split('·').pop().trim() : summary;
    return <div className="text-muted small text-center mt-2">{count}</div>;
  }

  return (
    <nav className="d-flex flex-column align-items-center gap-2 mt-3">
      <ul className="pagination mb-0">
        <li className={'page-item' + (page === 1 ? ' disabled' : '')}>
          <button className="page-link" onClick={() => onChange(Math.max(1, page - 1))}>Prev</button>
        </li>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <li key={n} className={'page-item' + (n === page ? ' active' : '')}>
            <button className="page-link" onClick={() => onChange(n)}>{n}</button>
          </li>
        ))}
        <li className={'page-item' + (page === totalPages ? ' disabled' : '')}>
          <button className="page-link" onClick={() => onChange(Math.min(totalPages, page + 1))}>Next</button>
        </li>
      </ul>
      {summary && <span className="text-muted small">{summary}</span>}
    </nav>
  );
}

export default Pagination;
