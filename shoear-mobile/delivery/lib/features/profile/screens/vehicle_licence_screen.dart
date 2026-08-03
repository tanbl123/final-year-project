import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';

/// Verified vehicle/licence details. The plate number and driving licence
/// decide who is legally allowed to deliver, so (unlike the operational fields
/// in Edit Profile) they can't be changed directly — the courier proposes a
/// change here and an admin re-approves it. The account stays active and keeps
/// delivering while a request is pending. Pops `true` if a request was filed.
///
/// The change form mirrors registration's KYC: IC front + back, and EITHER a
/// physical licence (front + back photos) OR a digital e-licence file (MyJPJ).
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
  final _plate = TextEditingController();
  final _licenseNumber = TextEditingController();
  final Set<String> _licenseClasses = {};
  DateTime? _licenseExpiry;

  // KYC docs (uploaded as soon as they're picked → store the returned URL)
  final _picker = ImagePicker();
  String? _licensePhotoUrl, _licensePhotoBackUrl, _eLicenseUrl, _icPhotoUrl, _icPhotoBackUrl;
  bool _licenseIsDigital = false;
  bool _upLicense = false, _upLicenseBack = false, _upELicense = false, _upIc = false, _upIcBack = false;
  String? _plateError, _licenseNumberError, _licenseClassError, _licenseExpiryError, _docsError;

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

  // Read a digital-licence flag stored as 1 / '1' / true.
  static bool _isDigital(Map m) =>
      m['licenseIsDigital'] == 1 || m['licenseIsDigital'] == '1' || m['licenseIsDigital'] == true;

  static String? _nonEmpty(dynamic v) =>
      (v?.toString().isNotEmpty ?? false) ? v.toString() : null;

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
    _licenseIsDigital    = _isDigital(c);
    _licensePhotoUrl     = _nonEmpty(c['licensePhotoUrl']);
    _licensePhotoBackUrl = _nonEmpty(c['licensePhotoBackUrl']);
    _eLicenseUrl         = _nonEmpty(c['eLicenseUrl']);
    _icPhotoUrl          = _nonEmpty(c['icPhotoUrl']);
    _icPhotoBackUrl      = _nonEmpty(c['icPhotoBackUrl']);
    _plateError = _licenseNumberError = _licenseClassError = _licenseExpiryError = _docsError = null;
    setState(() => _editing = true);
  }

  static DateTime? _parseDate(String? s) =>
      (s != null && s.length >= 10) ? DateTime.tryParse(s.substring(0, 10)) : null;

  String _fmtDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // Have all required docs been uploaded for the chosen licence form?
  bool get _docsUploaded =>
      _icPhotoUrl != null && _icPhotoBackUrl != null &&
      (_licenseIsDigital
          ? _eLicenseUrl != null
          : (_licensePhotoUrl != null && _licensePhotoBackUrl != null));

  void _setUploading(String which, bool v) {
    switch (which) {
      case 'license': _upLicense = v; break;
      case 'license_back': _upLicenseBack = v; break;
      case 'elicense': _upELicense = v; break;
      case 'ic': _upIc = v; break;
      case 'ic_back': _upIcBack = v; break;
    }
  }

  void _setUploadedUrl(String which, String url) {
    switch (which) {
      case 'license': _licensePhotoUrl = url; break;
      case 'license_back': _licensePhotoBackUrl = url; break;
      case 'elicense': _eLicenseUrl = url; break;
      case 'ic': _icPhotoUrl = url; break;
      case 'ic_back': _icPhotoBackUrl = url; break;
    }
  }

  Future<ImageSource?> _choosePhotoSource() => showModalBottomSheet<ImageSource>(
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

  Future<void> _pickPhoto(String which) async {
    final source = await _choosePhotoSource();
    if (source == null) return;
    final x = await _picker.pickImage(source: source, maxWidth: 1600, imageQuality: 85);
    if (x == null) return;
    await _uploadDoc(which, File(x.path));
  }

  // The digital e-licence may be an image OR a PDF (MyJPJ export).
  Future<void> _pickELicense() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    );
    final path = result?.files.single.path;
    if (path == null) return;
    await _uploadDoc('elicense', File(path));
  }

  Future<void> _uploadDoc(String which, File file) async {
    setState(() => _setUploading(which, true));
    try {
      final url = await context.read<AuthProvider>().authService.uploadRegistrationDoc(file);
      if (!mounted) return;
      setState(() {
        _setUploadedUrl(which, url);
        if (_docsUploaded) _docsError = null;
      });
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _setUploading(which, false));
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
      _docsError = _docsUploaded
          ? null
          : (_licenseIsDigital
              ? 'Upload both sides of your IC and your digital licence file.'
              : 'Upload both sides of your IC and both sides of your driving licence.');
    });
    if (_plateError != null || _licenseNumberError != null || _licenseClassError != null ||
        _licenseExpiryError != null || _docsError != null) {
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
            licenseIsDigital: _licenseIsDigital,
            licensePhotoUrl: _licenseIsDigital ? '' : (_licensePhotoUrl ?? ''),
            licensePhotoBackUrl: _licenseIsDigital ? '' : (_licensePhotoBackUrl ?? ''),
            eLicenseUrl: _licenseIsDigital ? (_eLicenseUrl ?? '') : '',
            icPhotoUrl: _icPhotoUrl ?? '',
            icPhotoBackUrl: _icPhotoBackUrl ?? '',
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
          } else if (lower.contains('ic') || lower.contains('photo') ||
              lower.contains('licence') || lower.contains('license')) {
            _docsError = msg;
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
    final digital = _isDigital(c);
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
        _viewRow('Licence type', digital ? 'Digital (e-licence)' : 'Physical card'),
        const SizedBox(height: 12),
        // Uploaded documents — physical front+back OR the digital e-licence file,
        // plus both sides of the IC.
        if (digital)
          _docThumb('Digital licence (e-licence)', c['eLicenseUrl']?.toString())
        else ...[
          _docThumb('Driving licence (front)', c['licensePhotoUrl']?.toString()),
          _docThumb('Driving licence (back)', c['licensePhotoBackUrl']?.toString()),
        ],
        _docThumb('IC (front)', c['icPhotoUrl']?.toString()),
        _docThumb('IC (back)', c['icPhotoBackUrl']?.toString()),
        const SizedBox(height: 8),
        FilledButton.icon(
          onPressed: _pending ? null : _startEdit,
          icon: const Icon(Icons.edit_outlined),
          label: Text(_pending ? 'Change pending review' : 'Request a change'),
        ),
      ],
    );
  }

  // A labelled document preview. Images render as a thumbnail; anything that
  // isn't an image (e.g. a PDF e-licence) falls back to a "file on record" card.
  Widget _docThumb(String label, String? url) {
    if (url == null || url.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              url,
              height: 150,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => Container(
                height: 90,
                width: double.infinity,
                color: Colors.grey.shade200,
                child: const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.description_outlined, color: Colors.grey),
                    SizedBox(height: 4),
                    Text('File on record', style: TextStyle(fontSize: 11, color: Colors.grey)),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── edit form: propose new plate + licence values (+ full KYC docs) ──
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
        // Physical card (front + back) OR a digital e-licence (MyJPJ) file.
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('Physical card'), icon: Icon(Icons.badge_outlined)),
            ButtonSegment(value: true, label: Text('Digital (e-licence)'), icon: Icon(Icons.smartphone_outlined)),
          ],
          selected: {_licenseIsDigital},
          onSelectionChanged: (s) => setState(() {
            _licenseIsDigital = s.first;
            // keep only the chosen mode's files
            if (_licenseIsDigital) {
              _licensePhotoUrl = null;
              _licensePhotoBackUrl = null;
            } else {
              _eLicenseUrl = null;
            }
            if (_docsUploaded) _docsError = null;
          }),
        ),
        const SizedBox(height: 12),
        if (_licenseIsDigital)
          _photoTile(label: 'Digital licence file (image or PDF)', url: _eLicenseUrl, uploading: _upELicense,
              error: _docsError != null && _eLicenseUrl == null, onPick: _pickELicense)
        else ...[
          _photoTile(label: 'Driving licence (front)', url: _licensePhotoUrl, uploading: _upLicense,
              error: _docsError != null && _licensePhotoUrl == null, onPick: () => _pickPhoto('license')),
          const SizedBox(height: 8),
          _photoTile(label: 'Driving licence (back)', url: _licensePhotoBackUrl, uploading: _upLicenseBack,
              error: _docsError != null && _licensePhotoBackUrl == null, onPick: () => _pickPhoto('license_back')),
        ],
        const SizedBox(height: 8),
        _photoTile(label: 'IC (front)', url: _icPhotoUrl, uploading: _upIc,
            error: _docsError != null && _icPhotoUrl == null, onPick: () => _pickPhoto('ic')),
        const SizedBox(height: 8),
        _photoTile(label: 'IC (back)', url: _icPhotoBackUrl, uploading: _upIcBack,
            error: _docsError != null && _icPhotoBackUrl == null, onPick: () => _pickPhoto('ic_back')),
        if (_docsError != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_docsError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
          ),
        const SizedBox(height: 20),
        Row(
          children: [
            // Cancel takes only the space it needs; Submit gets the rest so its
            // label ("Submit for review") stays on a single line.
            OutlinedButton(
              onPressed: _submitting ? null : () => setState(() => _editing = false),
              child: const Text('Cancel'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: (_submitting || _anyUploading) ? null : _submit,
                child: _submitting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Submit for review', maxLines: 1, softWrap: false),
              ),
            ),
          ],
        ),
      ],
    );
  }

  bool get _anyUploading => _upLicense || _upLicenseBack || _upELicense || _upIc || _upIcBack;

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

  // A tap-to-upload document tile (mirrors registration).
  Widget _photoTile({
    required String label,
    required String? url,
    required bool uploading,
    required VoidCallback onPick,
    bool error = false,
  }) =>
      InkWell(
        onTap: uploading ? null : onPick,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            border: Border.all(
              color: error ? Theme.of(context).colorScheme.error : Colors.grey.shade400,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  width: 56,
                  height: 56,
                  child: uploading
                      ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                      : (url == null
                          ? Container(color: Colors.grey.shade200, child: Icon(Icons.add_a_photo_outlined, color: Colors.grey.shade600))
                          : Image.network(url, fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => Container(color: Colors.grey.shade200, child: const Icon(Icons.description_outlined)))),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                        url != null
                            ? 'Uploaded · tap to replace'
                            : error
                                ? 'Required — tap to upload'
                                : 'Tap to upload',
                        style: TextStyle(
                            fontSize: 12,
                            color: url != null
                                ? Colors.green.shade700
                                : error
                                    ? Theme.of(context).colorScheme.error
                                    : Colors.grey.shade600)),
                  ],
                ),
              ),
              Icon(url == null ? Icons.upload_outlined : Icons.check_circle,
                  color: url == null ? Colors.grey : Colors.green),
            ],
          ),
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
