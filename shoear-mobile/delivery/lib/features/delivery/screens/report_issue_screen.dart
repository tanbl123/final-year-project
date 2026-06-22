import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/delivery/services/delivery_service.dart';

/// Courier reports a problem with a delivery: pick a structured reason, add an
/// optional note + photo, submit. Pops `true` on success so the caller refreshes
/// (the parcel may now be Failed or returned to the dispatch queue).
class ReportIssueScreen extends StatefulWidget {
  final String deliveryId;
  final String orderId;
  const ReportIssueScreen({super.key, required this.deliveryId, required this.orderId});

  @override
  State<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends State<ReportIssueScreen> {
  String? _reason;
  final _note = TextEditingController();
  File? _photo;
  bool _submitting = false;
  String? _reasonError;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 80);
    if (picked != null) setState(() => _photo = File(picked.path));
  }

  Future<void> _submit() async {
    if (_reason == null) {
      setState(() => _reasonError = 'Please choose a reason.');
      return;
    }
    setState(() => _submitting = true);
    try {
      await context.read<DeliveryService>().reportIssue(
            widget.deliveryId,
            _reason!,
            note: _note.text,
            photo: _photo,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Report an issue · ${widget.orderId}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text("What's the problem?", style: Theme.of(context).textTheme.titleMedium),
          if (_reasonError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(_reasonError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
            ),
          const SizedBox(height: 4),
          for (final (value, label) in deliveryIssueReasons)
            RadioListTile<String>(
              value: value,
              groupValue: _reason,
              onChanged: (v) => setState(() {
                _reason = v;
                _reasonError = null;
              }),
              title: Text(label),
              contentPadding: EdgeInsets.zero,
              dense: true,
            ),
          const SizedBox(height: 8),
          TextField(
            controller: _note,
            minLines: 2,
            maxLines: 4,
            maxLength: 255,
            decoration: const InputDecoration(
              labelText: 'Add a note (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _pickPhoto,
            icon: const Icon(Icons.add_a_photo_outlined),
            label: Text(_photo == null ? 'Attach a photo (optional)' : 'Photo attached · change'),
          ),
          if (_photo != null) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(_photo!, height: 160, width: double.infinity, fit: BoxFit.cover),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            child: _submitting
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Submit report'),
          ),
          const SizedBox(height: 8),
          Text(
            'Reporting will update the delivery and alert the support team. The customer is notified there was a problem.',
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }
}
