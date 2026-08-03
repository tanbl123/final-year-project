// Read-only user detail popup, shared by the Users page and the Flagged Content
// page (so a moderator can inspect the reported/reporting user WITHOUT leaving
// the moderation queue). Presentational: the parent fetches the user and passes
// `detail` (the user object, or {} while loading) + `loading` + `onClose`.

const STATUS_COLORS = { Active: 'success', Pending: 'warning', Suspended: 'secondary', Rejected: 'danger' };
const roleLabel = (r) => (r === 'DeliveryPersonnel' ? 'Delivery' : r === 'ArSpecialist' ? 'AR Specialist' : r);

// A document thumbnail (image) or a PDF link. `round` renders a circular
// thumbnail (used for the company logo).
function UserDoc({ label, url, round }) {
  const isPdf = !!url && /\.pdf(\?|$)/i.test(url);
  const shape = round ? 'rounded-circle' : 'rounded';
  return (
    <div className="col-6 col-md-4">
      <div className="text-muted small mb-1">{label}</div>
      {url ? (
        isPdf ? (
          <a href={url} target="_blank" rel="noreferrer" title="Open PDF"
            className="border rounded bg-light d-flex flex-column align-items-center justify-content-center text-decoration-none"
            style={{ height: 110 }}>
            <span style={{ fontSize: 24 }}>📄</span><span className="small">Open PDF</span>
          </a>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" title="Open full size">
            <img src={url} alt={label} className={`border ${shape}`}
              style={round
                ? { width: 110, height: 110, objectFit: 'cover' }
                : { width: '100%', height: 110, objectFit: 'cover' }} />
          </a>
        )
      ) : (
        <div className="border rounded bg-light d-flex align-items-center justify-content-center text-muted small"
          style={{ height: 110 }}>—</div>
      )}
    </div>
  );
}

function UserDetailModal({ detail, loading, onClose }) {
  if (!detail) return null;
  return (
    <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
      onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">User detail</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {loading || !detail.userId ? (
              <p className="text-muted mb-0">Loading…</p>
            ) : (
              <>
                <dl className="row mb-0">
                  <dt className="col-4">Name</dt><dd className="col-8">{detail.fullName}</dd>
                  <dt className="col-4">Username</dt><dd className="col-8">@{detail.username}</dd>
                  <dt className="col-4">Email</dt><dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{detail.email}</dd>
                  <dt className="col-4">Phone</dt><dd className="col-8">{detail.phoneNumber || <span className="text-muted">—</span>}</dd>
                  <dt className="col-4">Role</dt><dd className="col-8">{roleLabel(detail.role)}</dd>
                  <dt className="col-4">Status</dt>
                  <dd className="col-8">
                    <span className={`badge text-bg-${STATUS_COLORS[detail.status] || 'secondary'}`}>{detail.status}</span>
                    {detail.pendingSetup && (
                      <span className="badge text-bg-warning ms-1" title="Invite sent — hasn't set a password yet">Pending set-up</span>
                    )}
                  </dd>
                  {detail.role === 'Supplier' && detail.profile && (
                    <>
                      <dt className="col-4">Company (legal)</dt><dd className="col-8">{detail.profile.companyName}</dd>
                      {detail.profile.displayName && detail.profile.displayName !== detail.profile.companyName && (
                        <><dt className="col-4">Store name</dt><dd className="col-8">{detail.profile.displayName}</dd></>
                      )}
                      {detail.profile.businessRegNo && (
                        <><dt className="col-4">Business reg. no.</dt><dd className="col-8">{detail.profile.businessRegNo}</dd></>
                      )}
                      <dt className="col-4">Business address</dt><dd className="col-8">{detail.profile.companyAddress}</dd>
                      <dt className="col-4">Pickup address</dt><dd className="col-8">{detail.profile.operationalAddress || detail.profile.companyAddress}</dd>
                    </>
                  )}
                  {detail.role === 'Customer' && detail.profile && (
                    <>
                      <dt className="col-4">Shipping</dt>
                      <dd className="col-8">{detail.profile.shippingAddress || <span className="text-muted">—</span>}</dd>
                    </>
                  )}
                  {detail.role === 'DeliveryPersonnel' && detail.profile && (
                    <>
                      <dt className="col-4">Vehicle</dt>
                      <dd className="col-8">
                        {detail.profile.vehicleType && detail.profile.vehicleBrand
                          ? `${detail.profile.vehicleType} • ${detail.profile.vehicleBrand} ${detail.profile.vehicleModel} — ${detail.profile.vehiclePlate}`
                          : <span className="text-muted">—</span>}
                      </dd>
                      <dt className="col-4">IC / NRIC</dt>
                      <dd className="col-8">{detail.profile.icNumber || <span className="text-muted">—</span>}</dd>
                      <dt className="col-4">Licence no.</dt>
                      <dd className="col-8">{detail.profile.licenseNumber || <span className="text-muted">—</span>}</dd>
                      <dt className="col-4">Licence class</dt>
                      <dd className="col-8">{detail.profile.licenseClass || <span className="text-muted">—</span>}</dd>
                      <dt className="col-4">Licence expiry</dt>
                      <dd className="col-8">{detail.profile.licenseExpiry || <span className="text-muted">—</span>}</dd>
                      <dt className="col-4">Coverage</dt>
                      <dd className="col-8">{detail.profile.coverageZones || <span className="text-muted">—</span>}</dd>
                    </>
                  )}
                  {detail.role === 'ArSpecialist' && detail.profile && (
                    <>
                      <dt className="col-4">Staff ID</dt>
                      <dd className="col-8">{detail.profile.arSpecialistId}</dd>
                      <dt className="col-4">IC / NRIC</dt>
                      <dd className="col-8">{detail.profile.icNumber || <span className="text-muted">—</span>}</dd>
                    </>
                  )}
                  <dt className="col-4">Joined</dt>
                  <dd className="col-8">{new Date(detail.created_at).toLocaleString()}</dd>
                </dl>

                {(detail.role === 'DeliveryPersonnel' || detail.role === 'Supplier') && detail.profile && (
                  <>
                    <hr />
                    <div className="fw-semibold small mb-2">Documents</div>
                    <div className="row g-2">
                      {detail.role === 'DeliveryPersonnel' && (
                        <>
                          <UserDoc label="Profile photo" url={detail.avatarUrl} />
                          <UserDoc label="IC (front)" url={detail.profile.icPhotoUrl} />
                          <UserDoc label="IC (back)" url={detail.profile.icPhotoBackUrl} />
                          {Number(detail.profile.licenseIsDigital) === 1 ? (
                            <UserDoc label="Digital licence" url={detail.profile.eLicenseUrl} />
                          ) : (
                            <>
                              <UserDoc label="Licence (front)" url={detail.profile.licensePhotoUrl} />
                              <UserDoc label="Licence (back)" url={detail.profile.licensePhotoBackUrl} />
                            </>
                          )}
                        </>
                      )}
                      {detail.role === 'Supplier' && (
                        <>
                          {detail.profile.companyPhotoUrl && (
                            <UserDoc label="Company logo" url={detail.profile.companyPhotoUrl} round />
                          )}
                          <UserDoc label="Business licence" url={detail.profile.businessLicenseUrl} />
                        </>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UserDetailModal;
