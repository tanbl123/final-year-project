import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Document-style PDF export for the admin/supplier reports (Report Generation
// module). Renders a header (system name, report title, period, generated
// date/time, generated-by user, unique reference number), a summary section of
// KPIs, the detailed data table, and a system-generated footer with a timestamp
// and page numbers — matching the report layout described in the proposal.

const BRAND = 'ShoeAR';
const ACCENT = [79, 70, 229]; // indigo, matches the web theme

const pad = (n) => String(n).padStart(2, '0');

function makeReference(prefix, now) {
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
         `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * @param {object} opts
 * @param {string} opts.title          e.g. "Sales Report"
 * @param {string} [opts.generatedBy]  the signed-in user's name
 * @param {string} [opts.period]       reporting period label (default "All time")
 * @param {string} opts.referencePrefix short code for the reference no (e.g. "SR")
 * @param {{label:string,value:string}[]} [opts.summary] KPI rows
 * @param {string[]} opts.head         table header cells
 * @param {(string|number)[][]} opts.body  table rows
 * @param {(string|number)[][]} [opts.foot] totals row(s)
 * @param {object} [opts.columnStyles] jspdf-autotable column styles
 */
/**
 * Build the report PDF document (without saving) so callers can either preview
 * it (doc.output('blob')) or download it (doc.save). Returns { doc, filename }.
 * See generateReportPdf for the option shape.
 */
export function buildReportDoc({
  title,
  generatedBy,
  period = 'All time',
  referencePrefix,
  summary = [],
  head = [],
  body = [],
  foot = [],
  columnStyles = {},
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const now = new Date();
  const ref = makeReference(referencePrefix, now);
  const stamp = now.toLocaleString('en-MY');

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(BRAND, margin, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.text(title, margin, 70);

  doc.setFontSize(9);
  doc.setTextColor(110);
  const metaX = pageW - margin;
  doc.text(`Reference: ${ref}`, metaX, 42, { align: 'right' });
  doc.text(`Generated: ${stamp}`, metaX, 56, { align: 'right' });
  doc.text(`By: ${generatedBy || '—'}`, metaX, 70, { align: 'right' });
  doc.text(`Period: ${period}`, metaX, 84, { align: 'right' });
  doc.setTextColor(0);

  doc.setDrawColor(200);
  doc.line(margin, 96, pageW - margin, 96);

  let y = 116;

  // ── Summary KPIs ────────────────────────────────────────────────────────
  if (summary.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Summary', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'plain',
      body: summary.map((s) => [s.label, s.value]),
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 0: { textColor: 110 }, 1: { fontStyle: 'bold', halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 18;
  }

  // ── Detailed data table ───────────────────────────────────────────────────
  // Columns the caller right-aligns (numeric) — keep their HEADER and FOOTER
  // cells right-aligned too, so the column header sits above its figures
  // instead of drifting to the left of a wide auto-sized column.
  const rightCols = new Set(
    Object.entries(columnStyles)
      .filter(([, s]) => s && s.halign === 'right')
      .map(([k]) => Number(k)),
  );
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: head.length ? [head] : undefined,
    body,
    foot: foot.length ? foot : undefined,
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [240, 240, 245], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles,
    didParseCell: (data) => {
      if ((data.section === 'head' || data.section === 'foot') && rightCols.has(data.column.index)) {
        data.cell.styles.halign = 'right';
      }
    },
    // footer on every page
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`This is a system-generated document — ${BRAND}. ${stamp}`, margin, pageH - 24);
      doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageW - margin, pageH - 24, {
        align: 'right',
      });
      doc.setTextColor(0);
    },
  });

  return { doc, filename: `${title.replace(/\s+/g, '_')}_${ref}.pdf` };
}

/**
 * Build and immediately download the report PDF (the existing one-click export).
 * @param {object} opts see buildReportDoc
 */
export function generateReportPdf(opts) {
  const { doc, filename } = buildReportDoc(opts);
  doc.save(filename);
}
