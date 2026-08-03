import 'package:flutter/material.dart';

import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/appeal/appeal_service.dart';

/// Native appeal form for a suspended account. Reached from the login screen
/// (the suspended-login error carries the appeal uid + token). Uses the public
/// /appeal API — no login needed — so it works without depending on the web app.
class AppealScreen extends StatefulWidget {
  final String uid;
  final String token;
  const AppealScreen({super.key, required this.uid, required this.token});

  @override
  State<AppealScreen> createState() => _AppealScreenState();
}

class _AppealScreenState extends State<AppealScreen> {
  final _service = AppealService(ApiClient());
  final _message = TextEditingController();

  bool _loading = true;
  String? _blocked;      // non-null → show this message instead of the form
  String? _reason;
  bool _submitting = false;
  String? _error;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final ctx = await _service.context(widget.uid, widget.token);
      if (!mounted) return;
      setState(() {
        _reason = ctx['reason'] as String?;
        if (ctx['status'] != 'Suspended') {
          _blocked = 'This account is not currently suspended, so there is nothing to appeal.';
        } else if (ctx['openAppeal'] == true) {
          _blocked = 'You already have an appeal under review. We\'ll email you once it\'s decided.';
        }
        _loading = false;
      });
    } catch (e) {
      if (mounted) setState(() { _blocked = e.toString(); _loading = false; });
    }
  }

  Future<void> _submit() async {
    final msg = _message.text.trim();
    if (msg.isEmpty) { setState(() => _error = 'Please explain your appeal.'); return; }
    if (msg.length < 10) { setState(() => _error = 'Please give a bit more detail (at least 10 characters).'); return; }
    setState(() { _submitting = true; _error = null; });
    try {
      await _service.submit(widget.uid, widget.token, msg);
      if (mounted) setState(() { _done = true; _submitting = false; });
    } catch (e) {
      if (mounted) setState(() { _error = e.toString(); _submitting = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Appeal a suspension')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(20),
              child: _done
                  ? _centered('Thanks — your appeal has been submitted. Our team will review it and email you the outcome.', ok: true)
                  : _blocked != null
                      ? _centered(_blocked!)
                      : ListView(
                          children: [
                            const Text('Your account was suspended. If you believe this was a mistake, '
                                'explain below and our team will review it.'),
                            const SizedBox(height: 12),
                            if (_reason != null && _reason!.isNotEmpty) ...[
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: Colors.grey.shade100,
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('REASON GIVEN', style: TextStyle(fontSize: 11, color: Colors.grey)),
                                    const SizedBox(height: 4),
                                    Text(_reason!),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 16),
                            ],
                            TextField(
                              controller: _message,
                              maxLines: 5,
                              maxLength: 1000,
                              decoration: InputDecoration(
                                labelText: 'Your appeal',
                                border: const OutlineInputBorder(),
                                errorText: _error,
                                errorMaxLines: 3,
                              ),
                              onChanged: (_) { if (_error != null) setState(() => _error = null); },
                            ),
                            const SizedBox(height: 8),
                            FilledButton(
                              onPressed: _submitting ? null : _submit,
                              child: _submitting
                                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Text('Submit appeal'),
                            ),
                          ],
                        ),
            ),
    );
  }

  Widget _centered(String text, {bool ok = false}) => Center(
        child: Text(text, textAlign: TextAlign.center,
            style: TextStyle(color: ok ? Colors.green.shade700 : Colors.red.shade700)),
      );
}
