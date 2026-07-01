import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';

/// Verified vehicle/licence details. The plate number and driving licence
/// decide who is legally allowed to deliver, so (unlike the operational fields
/// in Edit Profile) they can't be changed directly — the courier proposes a
/// change here and an admin re-approves it. The account stays active and keeps
/// delivering while a request is pending. Pops `true` if a request was filed.
class VehicleLicenceScreen extends StatefulWidget {
  const VehicleLicenceScreen({super.key});

  @override
  State<VehicleLicenceScreen> createState() => _VehicleLicenceScreenState();
}

class _VehicleLicenceScreenState extends State<VehicleLicenceScreen> {
  static const _licenseClassOptions = [
    ('B2', 'B2 — Motorcycle (≤ 250cc)'),
    ('B', 'B — Motorcycle (any cc)'),
    ('D', 'D — Car (manual & automatic)'),
    ('DA', 'DA — Car (automatic only)'),
    ('E', 'E — Lorry / van'),
    ('E1', 'E1 — Light lorry'),
    ('E2', 'E2 — Medium lorry'),
  ];

  bool _loading = true;
  String? _loadError;
  Map<String, dynamic>? _current;
  Map<String, dynamic>? _latest;   // most recent change request (or null)

  // edit-mode form
  bool _editing = false;
  bool _submitting = false;
  bool _uploading = false;
  final _plate = TextEditingController();
  final _licenseNumber = TextEditingController();
  final Set<String> _licenseClasses = {};
  DateTime? _licenseExpiry;
  String? _licensePhotoUrl;
  String? _plateError, _licenseNumberError, _licenseClassError, _licenseExpiryError, _photoError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _plate.dispose();
    _licenseNumber.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _loadError = null; });
    try {
      final data = await context.read<AccountService>().verification();
      if (!mounted) return;
      setState(() {
        _current = (data['current'] as Map?)?.cast<String, dynamic>();
        _latest = (data['latestRequest'] as Map?)?.cast<String, dynamic>();
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _loadError = e.toString(); _loading = false; });
    }
  }

  bool get _pending => _latest != null && _latest!['requestStatus'] == 'Pending';

  // Seed the form from the current live values, then switch to edit mode.
  void _startEdit() {
    final c = _current ?? const {};
    _plate.text = c['vehiclePlate']?.toString() ?? '';
    _licenseNumber.text = c['licenseNumber']?.toString() ?? '';
    _licenseClasses
      ..clear()
      ..addAll((c['licenseClass']?.toString() ?? '')
          .split(',').map((e) => e.trim()).where((e) => e.isNotEmpty));
    _licenseExpiry = _parseDate(c['licenseExpiry']?.toString());
    _licensePhotoUrl = (c['licensePhotoUrl']?.toString().isNotEmpty ?? false)
        ? c['licensePhotoUrl'].toString() : null;
    _plateError = _licenseNumberError = _licenseClassError = _licenseExpiryError = _photoError = null;
    setState(() => _editing = true);
  }

  static DateTime? _parseDate(String? s) =>
      (s != null && s.length >= 10) ? DateTime.tryParse(s.substring(0, 10)) : null;

  String _fmtDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _pickLicensePhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    setState(() { _uploading = true; _photoError = null; });
    try {
      final x = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 85);
      if (x == null) { setState(() => _uploading = false); return; }
      final url = await context.read<AuthProvider>().authService.uploadRegistrationDoc(File(x.path));
      if (mounted) setState(() { _licensePhotoUrl = url; _uploading = false; });
    } catch (e) {
      if (mounted) setState(() { _photoError = e.toString(); _uploading = false; });
    }
  }

  Future<void> _pickLicenseClasses() async {
    final temp = Set<String>.from(_licenseClasses);
    final result = await showDialog<Set<String>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Driving licence class(es)'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final o in _licenseClassOptions)
                  CheckboxListTile(
                    value: temp.contains(o.$1),
                    title: Text(o.$2),
                    controlAffinity: ListTileControlAffinity.leading,
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (v) => setLocal(() { if (v == true) { temp.add(o.$1); } else { temp.remove(o.$1); } }),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, temp), child: const Text('Done')),
          ],
        ),
      ),
    );
    if (result != null) {
      setState(() {
        _licenseClasses..clear()..addAll(result);
        if (_licenseClasses.isNotEmpty) _licenseClassError = null;
      });
    }
  }

  Future<void> _pickLicenseExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _licenseExpiry ?? DateTime(now.year + 1, now.month, now.day),
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: DateTime(now.year + 20),
    );
    if (picked != null) setState(() { _licenseExpiry = picked; _licenseExpiryError = null; });
  }

  Future<void> _submit() async {
    final plate = _plate.text.trim().toUpperCase();
    final licNo = _licenseNumber.text.trim();
    setState(() {
      _plateError = (plate.length < 3 || !RegExp(r'^[A-Za-z0-9 \-]+$').hasMatch(plate))
          ? 'Enter a valid plate number (letters, numbers, spaces or hyphens).' : null;
      _licenseNumberError = licNo.isEmpty ? 'Driving licence number is required.' : null;
      _licenseClassError = _licenseClasses.isEmpty ? 'Select at least one licence class.' : null;
      _licenseExpiryError = _licenseExpiry == null ? 'Select your licence expiry date.' : null;
      _photoError = _licensePhotoUrl == null ? 'Upload a photo of your driving licence.' : null;
    });
    if (_plateError != null || _licenseNumberError != null || _licenseClassError != null ||
        _licenseExpiryError != null || _photoError != null) {
      return;
    }
    setState(() => _submitting = true);
    try {
      await context.read<AccountService>().submitVerificationChange(
            vehiclePlate: plate,
            licenseNumber: licNo,
            licenseClasses: _licenseClassOptions
                .where((o) => _licenseClasses.contains(o.$1)).map((o) => o.$1).toList(),
            licenseExpiry: _fmtDate(_licenseExpiry!),
            licensePhotoUrl: _licensePhotoUrl!,
          );
      if (!mounted) return;
      context.showSnack('Submitted for admin review. Your account stays active while we review it.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() { _submitting = false; });
      final msg = e.toString();
      final lower = msg.toLowerCase();
      if (mounted) {
        setState(() {
          if (lower.contains('plate')) {
            _plateError = msg;
          } else if (lower.contains('expired') || lower.contains('expiry')) {
            _licenseExpiryError = msg;
          } else if (lower.contains('class')) {
            _licenseClassError = msg;
          } else if (lower.contains('photo')) {
            _photoError = msg;
          } else if (lower.contains('licence') || lower.contains('license')) {
            _licenseNumberError = msg;
          } else {
            context.showSnack(msg);
          }
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vehicle & licence')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadError != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_loadError!, textAlign: TextAlign.center)))
              : _editing
                  ? _buildForm()
                  : _buildView(),
    );
  }

  // ── read-only view: current values + status banner + "request a change" ──
  Widget _buildView() {
    final c = _current ?? const {};
    final expiry = _parseDate(c['licenseExpiry']?.toString());
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_pending)
          _banner(
            color: Colors.orange,
            icon: Icons.hourglass_top,
            title: 'Changes pending review',
            body: 'You submitted changes on ${_fmtCreated(_latest!['created_at'])}. '
                'An admin is reviewing them — your current details below stay in effect until then.',
          )
        else if (_latest != null && _latest!['requestStatus'] == 'Rejected')
          _banner(
            color: Colors.red,
            icon: Icons.cancel_outlined,
            title: 'Last change was rejected',
            body: (_latest!['reviewNote']?.toString().isNotEmpty ?? false)
                ? 'Reason: ${_latest!['reviewNote']}'
                : 'Your previous request was rejected. You can submit a corrected one.',
          ),
        const Padding(
          padding: EdgeInsets.only(top: 4, bottom: 12),
          child: Text(
            'Your vehicle plate and driving licence are verified details. To change '
            'them you\'ll need admin re-approval — submit a request below and keep '
            'taking deliveries while we review it.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ),
        _viewRow('Plate number', c['vehiclePlate']?.toString()),
        _viewRow('Licence number', c['licenseNumber']?.toString()),
        _viewRow('Licence class', c['licenseClass']?.toString()),
        _viewRow('Licence expiry', expiry != null ? _fmtDate(expiry) : null),
        const SizedBox(height: 8),
        if ((c['licensePhotoUrl']?.toString().isNotEmpty ?? false))
          Align(
            alignment: Alignment.centerLeft,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(c['licensePhotoUrl'].toString(), height: 140, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink()),
            ),
          ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: _pending ? null : _startEdit,
          icon: const Icon(Icons.edit_outlined),
          label: Text(_pending ? 'Change pending review' : 'Request a change'),
        ),
      ],
    );
  }

  // ── edit form: propose new plate + licence values ──
  Widget _buildForm() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _banner(
          color: Colors.blue,
          icon: Icons.info_outline,
          title: 'These changes need admin re-approval',
          body: 'You can keep taking deliveries while we review. Update only what changed.',
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _plate,
          maxLength: 20,
          textCapitalization: TextCapitalization.characters,
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 \-]'))],
          decoration: InputDecoration(
            labelText: 'Plate number (e.g. ABC 1234)',
            border: const OutlineInputBorder(),
            errorText: _plateError,
          ),
          onChanged: (_) => setState(() => _plateError = null),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _licenseNumber,
          maxLength: 20,
          decoration: InputDecoration(
            labelText: 'Driving licence number',
            border: const OutlineInputBorder(),
            errorText: _licenseNumberError,
          ),
          onChanged: (_) => setState(() => _licenseNumberError = null),
        ),
        const SizedBox(height: 4),
        InkWell(
          onTap: _pickLicenseClasses,
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: 'Licence class(es)',
              border: const OutlineInputBorder(),
              errorText: _licenseClassError,
              suffixIcon: const Icon(Icons.arrow_drop_down),
            ),
            child: Text(
              _licenseClasses.isEmpty
                  ? 'Select your licence class(es)'
                  : _licenseClassOptions.where((o) => _licenseClasses.contains(o.$1)).map((o) => o.$1).join(', '),
              style: TextStyle(
                color: _licenseClasses.isEmpty ? Theme.of(context).hintColor : Theme.of(context).colorScheme.onSurface,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        InkWell(
          onTap: _pickLicenseExpiry,
          child: InputDecorator(
            decoration: InputDecoration(
              labelText: 'Licence expiry date',
              border: const OutlineInputBorder(),
              errorText: _licenseExpiryError,
              suffixIcon: const Icon(Icons.calendar_today_outlined),
            ),
            child: Text(
              _licenseExpiry != null ? _fmtDate(_licenseExpiry!) : 'Select a date',
              style: TextStyle(
                color: _licenseExpiry != null ? Theme.of(context).colorScheme.onSurface : Theme.of(context).hintColor,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('Driving licence photo', style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 8),
        if (_licensePhotoUrl != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(_licensePhotoUrl!, height: 140, fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const SizedBox.shrink()),
          ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _uploading ? null : _pickLicensePhoto,
          icon: _uploading
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.upload_outlined),
          label: Text(_licensePhotoUrl == null ? 'Upload licence photo' : 'Replace photo'),
        ),
        if (_photoError != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_photoError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
          ),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _submitting ? null : () => setState(() => _editing = false),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: (_submitting || _uploading) ? null : _submit,
                child: _submitting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Submit for review'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _fmtCreated(dynamic raw) {
    final d = _parseDate(raw?.toString());
    return d != null ? _fmtDate(d) : 'a recent date';
  }

  Widget _viewRow(String k, String? v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 130, child: Text(k, style: const TextStyle(color: Colors.grey))),
            Expanded(child: Text((v == null || v.isEmpty) ? '—' : v)),
          ],
        ),
      );

  Widget _banner({required Color color, required IconData icon, required String title, required String body}) =>
      Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(fontWeight: FontWeight.bold, color: color)),
                  const SizedBox(height: 2),
                  Text(body, style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ],
        ),
      );
}
