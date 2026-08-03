import { useEffect, useMemo, useState } from 'react';
import { getCommissionReport, getCommission, setCommission } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import ClearableInput from '../../../components/ClearableInput';
import SortableTh from '../../../components/SortableTh';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const SUPPLIER_PAGE_SIZE = 10;

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ALL_TIME = { from: null, to: null, label: 'All time' };

function AdminCommissionPage() {
  const { user } = useAuth();
  const [range, setRange] = useState(ALL_TIME);
  const [data, setData] = useState(null);          // per-supplier report
  const [commission, setCommissionState] = useState(null);  // { current, history }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [newRate, setNewRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');

  // per-supplier table: search + sort + paginate (totals row stays the full sum)
  const bySupplier = data?.bySupplier ?? [];
  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    return q ? bySupplier.filter((s) => String(s.companyName).toLowerCase().includes(q)) : bySupplier;
  }, [bySupplier, supplierSearch]);
  const supplierSort = useTableSort(filteredSuppliers, {
    initialKey: 'gross',
    initialDir: 'desc',
    getValue: (s, k) => (['units', 'gross', 'commission', 'serviceTax'].includes(k) ? Number(s[k]) : s[k] ?? ''),
  });
  const supPage = usePagination(supplierSort.sorted, SUPPLIER_PAGE_SIZE);

  function load(r = range) {
    setLoading(true);
    Promise.all([getCommission(), getCommissionReport({ from: r.from, to: r.to })])
      .then(([c, rep]) => {
        setCommissionState(c);
        setData(rep);
        // prefill the input with the current rate so the admin can nudge it with
        // the spinner (e.g. 10 → 11) instead of starting from an empty field
        const cur = c?.current?.commissionRateValue;
        if (cur != null) setNewRate(String(Number(cur)));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(range);
  }, [range.from, range.to]);

  const rateError = (() => {
    if (newRate === '') return '';
    const n = Number(newRate);
    if (Number.isNaN(n)) return 'Enter a number.';
    if (n < 0 || n > 100) return 'Rate must be between 0 and 100.';
    return '';
  })();

  async function applyRate() {
    setSaving(true);
    setError('');
    try {
      await setCommission(Number(newRate));
      setToast(`Commission rate set to ${Number(newRate)}%.`);
      load();   // reloads + prefills the input with the new current rate
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const currentRate = commission?.current?.commissionRateValue != null
    ? Number(commission.current.commissionRateValue) : null;

  const hasReport = !!data && data.summary.suppliers > 0;
  const growth = data?.period?.growthPct;

  const sstRate = data?.serviceTaxRate ?? 0;
  const serviceTax = data?.summary.totalServiceTax ?? 0;

  // Report options for preview + download (same document for both).
  function buildReportOpts() {
    const rate = data.commissionRate;
    return {
      title: 'Commission Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'CR',
      summary: [
        { label: 'Gross sales', value: rm(data.summary.grossSales) },
        { label: `Total commission (${rate}%)`, value: rm(data.summary.totalCommission) },
        { label: `SST (${sstRate}%) on commission`, value: rm(serviceTax) },
        { label: 'Suppliers with sales', value: String(data.summary.suppliers) },
        { label: 'Current commission rate', value: currentRate != null ? `${currentRate}%` : '—' },
        ...(growth != null
          ? [{ label: 'Gross sales vs previous period', value: `${growth > 0 ? '+' : ''}${growth}%` }]
          : []),
      ],
      head: ['Supplier', 'Units', 'Gross sales', `Commission (${rate}%)`, `SST (${sstRate}%)`],
      body: data.bySupplier.map((s) => [s.companyName, s.units, rm(s.gross), rm(s.commission), rm(s.serviceTax)]),
      foot: [['Total', '—', rm(data.summary.grossSales), rm(data.summary.totalCommission), rm(serviceTax)]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    };
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">💰 Commission</h1>
      <p className="text-muted">Set the platform commission rate and review earnings across suppliers.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          {/* rate configuration */}
          <div className="card mb-4">
            <div className="card-header bg-white fw-semibold">Commission rate</div>
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-auto">
                  <div className="text-muted small text-uppercase">Current rate</div>
                  <div className="fs-3 fw-bold text-success">
                    {currentRate != null ? `${currentRate}%` : <span className="text-muted fs-5">none set</span>}
                  </div>
                </div>
                <div className="col-sm-4">
                  <label className="form-label small text-muted mb-1">New rate (%)</label>
                  <input type="number" min="0" max="100" step="0.01" placeholder="e.g. 10"
                    className={'form-control' + (rateError ? ' is-invalid' : '')}
                    value={newRate} onChange={(e) => setNewRate(e.target.value)} />
                  {rateError && <div className="invalid-feedback">{rateError}</div>}
                </div>
                <div className="col-auto">
                  <button className="btn btn-primary"
                    disabled={saving || newRate === '' || !!rateError || Number(newRate) === currentRate}
                    onClick={() => setConfirm(true)}>
                    {saving ? 'Saving…' : 'Update rate'}
                  </button>
                </div>
              </div>
              <p className="text-muted small mb-0 mt-2">
                The new rate applies to commission on sales from now on. The previous rate is kept as history.
              </p>

              {commission?.history?.length > 0 && (
                <>
                  <hr />
                  <h6 className="text-muted">Rate history</h6>
                  <table className="table table-sm w-auto mb-0">
                    <thead>
                      <tr>
                        <th style={{ width: 90 }}>Rate</th>
                        <th style={{ width: 180 }}>Effective</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th>Set by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commission.history.map((h) => (
                        <tr key={h.commissionId}>
                          <td className="fw-semibold">{h.commissionRateValue}%</td>
                          <td>{new Date(h.effectiveDate).toLocaleDateString()}</td>
                          <td>
                            <span className={`badge text-bg-${h.commissionStatus === 'Active' ? 'success' : 'secondary'}`}>
                              {h.commissionStatus}
                            </span>
                          </td>
                          <td>{h.setBy || <span className="text-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>

          {/* per-supplier report */}
          <div className="d-flex justify-content-between align-items-end mb-2 flex-wrap gap-2">
            <h5 className="mb-0">Commission earned by supplier</h5>
            <div className="d-flex align-items-end gap-2 flex-wrap">
              <ReportPeriodBar onChange={setRange} />
              <button className="btn btn-outline-primary btn-sm" onClick={() => setPreview(true)} disabled={!hasReport}>
                👁 Preview &amp; export
              </button>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="text-muted small">Showing: <span className="fw-semibold">{range.label}</span></span>
            {growth != null && (
              <span className={`badge rounded-pill text-bg-${growth >= 0 ? 'success' : 'danger'}`}>
                {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% vs previous period
              </span>
            )}
          </div>
          {!data || data.summary.suppliers === 0 ? (
            <div className="card card-body text-center text-muted">No sales recorded yet.</div>
          ) : (
            <>
              <div className="row g-3 mb-4">
                <div className="col-6 col-lg-3">
                  <div className="card h-100"><div className="card-body">
                    <div className="text-muted small text-uppercase">Gross sales</div>
                    <div className="fs-4 fw-semibold">{rm(data.summary.grossSales)}</div>
                  </div></div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="card h-100"><div className="card-body">
                    <div className="text-muted small text-uppercase">Commission ({data.commissionRate}%)</div>
                    <div className="fs-4 fw-semibold text-success">{rm(data.summary.totalCommission)}</div>
                  </div></div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="card h-100"><div className="card-body">
                    <div className="text-muted small text-uppercase">SST ({sstRate}%)</div>
                    <div className="fs-4 fw-semibold">{rm(serviceTax)}</div>
                    <div className="text-muted small">on commission · remitted</div>
                  </div></div>
                </div>
                <div className="col-6 col-lg-3">
                  <div className="card h-100"><div className="card-body">
                    <div className="text-muted small text-uppercase">Suppliers with sales</div>
                    <div className="fs-4 fw-semibold">{data.summary.suppliers}</div>
                  </div></div>
                </div>
              </div>

              <div className="mb-3" style={{ maxWidth: 360 }}>
                <ClearableInput type="text" placeholder="Search supplier"
                  value={supplierSearch}
                  onChange={(e) => { setSupplierSearch(e.target.value); supPage.setPage(1); }}
                  onClear={() => { setSupplierSearch(''); supPage.setPage(1); }} />
              </div>

              {filteredSuppliers.length === 0 ? (
                <div className="card card-body text-center text-muted">No suppliers match your search.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <SortableTh label="Supplier" columnKey="companyName" sort={supplierSort} />
                        <SortableTh label="Units" columnKey="units" sort={supplierSort} className="text-end" style={{ width: 110 }} />
                        <SortableTh label="Gross sales" columnKey="gross" sort={supplierSort} className="text-end" style={{ width: 150 }} />
                        <SortableTh label={`Commission (${data.commissionRate}%)`} columnKey="commission" sort={supplierSort} className="text-end" style={{ width: 160 }} />
                        <SortableTh label={`SST (${sstRate}%)`} columnKey="serviceTax" sort={supplierSort} className="text-end" style={{ width: 120 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {supPage.pageItems.map((s) => (
                        <tr key={s.supplierId}>
                          <td className="fw-semibold">{s.companyName}</td>
                          <td className="text-end">{s.units}</td>
                          <td className="text-end">{rm(s.gross)}</td>
                          <td className="text-end text-success">{rm(s.commission)}</td>
                          <td className="text-end text-muted">{rm(s.serviceTax)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="fw-semibold border-top">
                        <td>Total (all suppliers)</td>
                        <td className="text-end">—</td>
                        <td className="text-end">{rm(data.summary.grossSales)}</td>
                        <td className="text-end text-success">{rm(data.summary.totalCommission)}</td>
                        <td className="text-end text-muted">{rm(serviceTax)}</td>
                      </tr>
                    </tfoot>
                  </table>

                  <Pagination page={supPage.page} totalPages={supPage.totalPages} onChange={supPage.setPage}
                    summary={`Page ${supPage.page} of ${supPage.totalPages} · ${filteredSuppliers.length} supplier${filteredSuppliers.length === 1 ? '' : 's'}`} />
                </div>
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={confirm}
        title="Update commission rate?"
        message={`Set the platform commission rate to ${newRate}%? It applies to commission on sales from now on.`}
        confirmText="Update"
        confirmColor="primary"
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); applyRate(); }}
      />

      <Toast message={toast} onClose={() => setToast('')} />

      <ReportPreviewModal open={preview} onClose={() => setPreview(false)} build={buildReportOpts} />
    </div>
  );
}

export default AdminCommissionPage;
