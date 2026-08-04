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
  const [detail, setDetail] = useState(null);   // refund shown in the details popup

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
                <th className="text-center" style={{ width: 100 }}>Details</th>
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
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setDetail(r)}>Details</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${refunds.length} refunds`} />
        </div>
      )}

      {/* Read-only refund details (the admin processes them) */}
      {detail && (() => {
        const r = detail;
        const proofs = refundProofUrls(r.refundProof);
        return (
          <div className="modal show d-block" tabIndex="-1"
            style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setDetail(null)}>
            <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    Refund details
                    <span className={`badge ms-2 text-bg-${STATUS_COLORS[r.refundStatus] || 'secondary'}`}>{r.refundStatus}</span>
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setDetail(null)}></button>
                </div>
                <div className="modal-body">
                  <dl className="row mb-0">
                    <dt className="col-sm-3">Order</dt>
                    <dd className="col-sm-9">
                      <Link to={`/orders/${r.orderId}`} className="text-decoration-none" onClick={() => setDetail(null)}>
                        {r.orderId} — view order &amp; products
                      </Link>
                    </dd>
                    <dt className="col-sm-3">Requested</dt><dd className="col-sm-9">{new Date(r.requestDate).toLocaleString()}</dd>
                    <dt className="col-sm-3">Amount</dt><dd className="col-sm-9">{money(r.refundAmount)}</dd>
                    <dt className="col-sm-3">Reason</dt>
                    <dd className="col-sm-9" style={{ overflowWrap: 'anywhere' }}>{r.refundReason}</dd>
                    {r.adminNote && (<>
                      <dt className="col-sm-3">Admin note</dt>
                      <dd className="col-sm-9" style={{ overflowWrap: 'anywhere' }}>{r.adminNote}</dd>
                    </>)}
                  </dl>

                  <div className="mt-3">
                    <div className="fw-semibold mb-2">Evidence photos {proofs.length > 0 && `(${proofs.length})`}</div>
                    {proofs.length === 0 ? (
                      <p className="text-muted mb-0">No photos were attached.</p>
                    ) : (
                      <div className="d-flex flex-wrap gap-2">
                        {proofs.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" title="Open full size">
                            <img src={u} alt={`Evidence ${i + 1}`}
                              style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid #dee2e6' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default SupplierRefundsPage;
