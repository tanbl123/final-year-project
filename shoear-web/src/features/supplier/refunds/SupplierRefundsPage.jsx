import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getSupplierRefunds, refundProofUrls } from './refundService';
import Pagination from '../../../components/Pagination';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const TABS = ['All', 'Pending', 'Approved', 'Rejected', 'Completed'];
const STATUS_COLORS = { Pending: 'warning', Approved: 'info', Rejected: 'danger', Completed: 'success' };
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function SupplierRefundsPage() {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('All');

  // Click any column header to sort; Amount compares numerically.
  const sort = useTableSort(refunds, {
    initialKey: 'requestDate',
    initialDir: 'desc',
    getValue: (r, k) => {
      if (k === 'refundAmount') return Number(r.refundAmount);
      return r[k] ?? '';
    },
  });

  // page lives in the URL (survives opening an order and coming back); resets to
  // 1 when the status tab changes
  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE, tab);

  function load() {
    setLoading(true);
    getSupplierRefunds({ status: tab === 'All' ? '' : tab })
      .then((data) => setRefunds(data.refunds))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // count of open (Pending) refunds for the little summary
  const openCount = useMemo(() => refunds.filter((r) => r.refundStatus === 'Pending').length, [refunds]);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">💸 Refunds</h1>
      <p className="text-muted">
        Refund requests on orders that include your products. The admin reviews and processes them.
      </p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* status tabs */}
      <ul className="nav nav-tabs mb-3">
        {TABS.map((t) => (
          <li className="nav-item" key={t}>
            <button className={'nav-link' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {t}
              {t === 'Pending' && openCount > 0 && tab === 'All' && (
                <span className="badge text-bg-warning ms-2">{openCount}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : refunds.length === 0 ? (
        <div className="card card-body text-center text-muted">
          {tab === 'All' ? 'No refund requests on your orders yet.' : `No ${tab.toLowerCase()} refunds.`}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Order" columnKey="orderId" sort={sort} style={{ width: 140 }} />
                <SortableTh label="Reason" columnKey="refundReason" sort={sort} />
                <SortableTh label="Amount" columnKey="refundAmount" sort={sort} className="text-end" style={{ width: 120 }} />
                <SortableTh label="Status" columnKey="refundStatus" sort={sort} className="text-center" style={{ width: 120 }} />
                <SortableTh label="Requested" columnKey="requestDate" sort={sort} style={{ width: 120 }} />
                <th className="text-center" style={{ width: 90 }}>Proof</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.refundId}>
                  <td>
                    <Link to={`/orders/${r.orderId}`} className="fw-semibold text-decoration-none">
                      {r.orderId}
                    </Link>
                  </td>
                  <td style={{ overflowWrap: 'anywhere' }}>{r.refundReason}</td>
                  <td className="text-end fw-semibold">{money(r.refundAmount)}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[r.refundStatus] || 'secondary'}`}>{r.refundStatus}</span>
                  </td>
                  <td className="text-muted small">{new Date(r.requestDate).toLocaleDateString()}</td>
                  <td className="text-center">
                    {(() => {
                      const urls = refundProofUrls(r.refundProof);
                      if (urls.length === 0) return <span className="text-muted">—</span>;
                      if (urls.length === 1) {
                        return <a href={urls[0]} target="_blank" rel="noreferrer" className="btn btn-outline-secondary btn-sm">View</a>;
                      }
                      return urls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="btn btn-outline-secondary btn-sm me-1">#{i + 1}</a>
                      ));
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${refunds.length} refunds`} />
        </div>
      )}
    </div>
  );
}

export default SupplierRefundsPage;
