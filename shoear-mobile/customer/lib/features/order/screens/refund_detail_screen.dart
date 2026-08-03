import 'package:flutter/material.dart';

import 'package:customer/features/order/models/order.dart';
import 'package:customer/core/widgets/product_image.dart';

const Map<String, Color> _refundColors = {
  'Pending': Colors.orange,
  'Approved': Colors.indigo,
  'Rejected': Colors.red,
  'Completed': Colors.green,
};

/// Full status view of a single refund request (Shopee-style "Return/Refund
/// Details"): a status timeline, the reason, the evidence photos, and amounts.
class RefundDetailScreen extends StatelessWidget {
  final OrderRefund refund;
  const RefundDetailScreen({super.key, required this.refund});

  Color get _color => _refundColors[refund.refundStatus] ?? Colors.grey;
  bool get _rejected => refund.refundStatus == 'Rejected';

  String _fmt(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
    final ampm = l.hour < 12 ? 'AM' : 'PM';
    return '${l.day}/${l.month}/${l.year} · $h:${l.minute.toString().padLeft(2, '0')} $ampm';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey.shade100,
      appBar: AppBar(
        title: const Text('Refund Details'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          // ── Status banner ──────────────────────────────────────────────
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: _color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _color.withValues(alpha: 0.25)),
            ),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: _color.withValues(alpha: 0.15), shape: BoxShape.circle),
                  child: Icon(
                    _rejected ? Icons.cancel_outlined : Icons.assignment_return_outlined,
                    color: _color,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_statusTitle(),
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: _color)),
                      const SizedBox(height: 2),
                      Text('Refund ${refund.refundId}',
                          style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
                    ],
                  ),
                ),
                Text('RM ${refund.refundAmount.toStringAsFixed(2)}',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: _color)),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // ── Timeline ───────────────────────────────────────────────────
          _Card(
            icon: Icons.timeline,
            title: 'Status',
            child: _Timeline(status: refund.refundStatus, requestDate: _fmt(refund.requestDate)),
          ),
          const SizedBox(height: 12),

          // ── Reason ─────────────────────────────────────────────────────
          _Card(
            icon: Icons.chat_bubble_outline,
            title: 'Reason',
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(refund.refundReason, style: const TextStyle(height: 1.4)),
            ),
          ),
          const SizedBox(height: 12),

          // ── Admin's decision note (why it was approved/rejected) ────────
          if ((refund.adminNote ?? '').isNotEmpty) ...[
            _Card(
              icon: _rejected ? Icons.info_outline : Icons.verified_outlined,
              title: _rejected ? 'Why it was rejected' : 'Note from the team',
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(refund.adminNote!, style: const TextStyle(height: 1.4)),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // ── Evidence photos ────────────────────────────────────────────
          if (refund.proofUrls.isNotEmpty) ...[
            _Card(
              icon: Icons.photo_library_outlined,
              title: 'Evidence (${refund.proofUrls.length})',
              child: Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final u in refund.proofUrls)
                    GestureDetector(
                      onTap: () => _viewPhoto(context, u),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: SizedBox(width: 80, height: 80, child: ProductImage(url: u)),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          // ── Details ────────────────────────────────────────────────────
          _Card(
            icon: Icons.receipt_long_outlined,
            title: 'Details',
            child: Column(
              children: [
                _kv('Refund amount', 'RM ${refund.refundAmount.toStringAsFixed(2)}'),
                _kv('Requested on', _fmt(refund.requestDate)),
                _kv('Status', refund.refundStatus),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _statusTitle() {
    switch (refund.refundStatus) {
      case 'Pending':
        return 'Under review';
      case 'Approved':
        return 'Approved · refund on the way';
      case 'Rejected':
        return 'Refund rejected';
      case 'Completed':
        return 'Refunded';
      default:
        return refund.refundStatus;
    }
  }

  void _viewPhoto(BuildContext context, String url) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Stack(
          children: [
            InteractiveViewer(child: Center(child: Image.network(url))),
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 110, child: Text(k, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
            Expanded(child: Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
          ],
        ),
      );
}

// ── Vertical status timeline ────────────────────────────────────────────────
class _Timeline extends StatelessWidget {
  final String status;
  final String requestDate;
  const _Timeline({required this.status, required this.requestDate});

  @override
  Widget build(BuildContext context) {
    final rejected = status == 'Rejected';
    // Build the steps and which index is "reached".
    final List<({String label, String? sub})> steps;
    int reached; // last completed/active index
    Color activeColor;

    if (rejected) {
      steps = [
        (label: 'Requested', sub: requestDate),
        (label: 'Reviewed', sub: null),
        (label: 'Rejected', sub: null),
      ];
      reached = 2;
      activeColor = Colors.red;
    } else {
      steps = [
        (label: 'Requested', sub: requestDate),
        (label: 'Under review', sub: null),
        (label: 'Approved', sub: null),
        (label: 'Refunded', sub: null),
      ];
      reached = switch (status) {
        'Pending' => 1,
        'Approved' => 2,
        'Completed' => 3,
        _ => 0,
      };
      activeColor = _refundColors[status] ?? Colors.indigo;
    }

    return Column(
      children: [
        for (int i = 0; i < steps.length; i++)
          _step(
            label: steps[i].label,
            sub: steps[i].sub,
            done: i < reached,
            active: i == reached,
            isLast: i == steps.length - 1,
            color: activeColor,
          ),
      ],
    );
  }

  Widget _step({
    required String label,
    String? sub,
    required bool done,
    required bool active,
    required bool isLast,
    required Color color,
  }) {
    final reachedStep = done || active;
    final dotColor = reachedStep ? color : Colors.grey.shade300;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 18,
                height: 18,
                decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                child: done
                    ? const Icon(Icons.check, size: 12, color: Colors.white)
                    : (active ? const Icon(Icons.circle, size: 8, color: Colors.white) : null),
              ),
              if (!isLast)
                Expanded(
                  child: Container(width: 2, color: done ? color : Colors.grey.shade300),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Padding(
            padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: TextStyle(
                        fontWeight: reachedStep ? FontWeight.w600 : FontWeight.normal,
                        color: reachedStep ? Colors.black87 : Colors.grey)),
                if (sub != null)
                  Text(sub, style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── White section card ─────────────────────────────────────────────────────
class _Card extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget child;
  const _Card({required this.icon, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(padding: const EdgeInsets.all(16), child: child),
        ],
      ),
    );
  }
}
