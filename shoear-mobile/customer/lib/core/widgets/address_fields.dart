import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:customer/core/services/postcode_service.dart';
import 'package:customer/core/services/places_service.dart';

/// The 16 Malaysian states + federal territories (must match the backend list).
const kMalaysianStates = <String>[
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
];

/// A structured Malaysian address (line 1 holds the whole street address).
class AddressValue {
  final String line1;
  final String postcode;
  final String city;
  final String? state;
  const AddressValue({this.line1 = '', this.postcode = '', this.city = '', this.state});

  /// Combined single-line form for display columns, e.g.
  /// "12 Jalan Mawar, 50480 Kuala Lumpur, Kuala Lumpur".
  String get combined {
    final parts = <String>[];
    if (line1.trim().isNotEmpty) parts.add(line1.trim());
    final pc = [postcode.trim(), city.trim()].where((s) => s.isNotEmpty).join(' ');
    if (pc.isNotEmpty) parts.add(pc);
    if ((state ?? '').trim().isNotEmpty) parts.add(state!.trim());
    return parts.join(', ');
  }
}

/// Per-field error messages (null = valid).
class AddressFieldErrors {
  final String? line1;
  final String? postcode;
  final String? city;
  final String? state;
  const AddressFieldErrors({this.line1, this.postcode, this.city, this.state});
  bool get any => line1 != null || postcode != null || city != null || state != null;
}

/// Validate a structured address (mirrors the checkout + backend rules).
AddressFieldErrors validateAddressValue(AddressValue a) {
  String? line1, postcode, city, state;
  if (a.line1.trim().isEmpty) {
    line1 = 'Address line is required.';
  } else if (a.line1.trim().length > 255) {
    line1 = 'Address is too long.';
  }
  if (a.postcode.trim().isEmpty) {
    postcode = 'Postcode is required.';
  } else if (!RegExp(r'^\d{5}$').hasMatch(a.postcode.trim())) {
    postcode = 'Postcode must be 5 digits.';
  }
  if (a.city.trim().isEmpty) city = 'City is required.';
  if ((a.state ?? '').isEmpty) state = 'Please select a state.';
  return AddressFieldErrors(line1: line1, postcode: postcode, city: city, state: state);
}

/// Reusable structured-address entry: line 1 (with Google Places suggestions
/// when a key is configured), postcode (auto-fills city + state from the offline
/// dataset), city and a state dropdown. Shared by checkout and edit-profile so
/// every address is entered the same way. Owns its controllers and reports the
/// current value via [onChanged]; pass [errors] back in to show validation.
class AddressFields extends StatefulWidget {
  final AddressValue initial;
  final ValueChanged<AddressValue> onChanged;
  final AddressFieldErrors errors;
  const AddressFields({
    super.key,
    required this.initial,
    required this.onChanged,
    this.errors = const AddressFieldErrors(),
  });

  @override
  State<AddressFields> createState() => _AddressFieldsState();
}

class _AddressFieldsState extends State<AddressFields> {
  late final TextEditingController _line1 = TextEditingController(text: widget.initial.line1);
  late final TextEditingController _postcode = TextEditingController(text: widget.initial.postcode);
  late final TextEditingController _city = TextEditingController(text: widget.initial.city);
  late String? _state =
      (widget.initial.state?.isNotEmpty ?? false) ? widget.initial.state : null;

  Timer? _debounce;
  List<PlaceSuggestion> _suggestions = const [];
  String? _placeSession;
  bool _autoFilled = false; // city/state came from a lookup (safe to overwrite)

  @override
  void initState() {
    super.initState();
    // rebuild as line 1 changes so its clear (✕) button shows/hides
    _line1.addListener(_refresh);
  }

  void _refresh() => setState(() {});

  void _emit() => widget.onChanged(AddressValue(
        line1: _line1.text, postcode: _postcode.text, city: _city.text, state: _state));

  void _clearLine1() {
    _line1.clear();
    setState(() => _suggestions = const []);
    _emit();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _line1.dispose();
    _postcode.dispose();
    _city.dispose();
    super.dispose();
  }

  // line 1 → debounced Places suggestions (no-op when Places is disabled)
  void _onLine1(String v) {
    _emit();
    if (!PlacesService.instance.enabled) return;
    _debounce?.cancel();
    final q = v.trim();
    if (q.length < 3) {
      if (_suggestions.isNotEmpty) setState(() => _suggestions = const []);
      return;
    }
    _placeSession ??= PlacesService.instance.newSessionToken();
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final r = await PlacesService.instance.autocomplete(q, _placeSession!);
      if (!mounted) return;
      setState(() => _suggestions = r);
    });
  }

  Future<void> _pick(PlaceSuggestion s) async {
    final token = _placeSession ?? PlacesService.instance.newSessionToken();
    setState(() => _suggestions = const []);
    final addr = await PlacesService.instance.details(s.placeId, token);
    _placeSession = null;
    if (!mounted) return;
    // Line 1 = the premise (street + taman), never the city/state/postcode.
    String street = PlacesService.instance.premiseFromDescription(s.description, addr?.city ?? '');
    if (street.isEmpty) {
      street = (addr != null && addr.line1.isNotEmpty)
          ? addr.line1
          : (s.mainText.isNotEmpty ? s.mainText : s.description.split(',').first.trim());
    }
    setState(() {
      _line1.text = street;
      if (addr != null) {
        _city.text = addr.city;
        _postcode.text = addr.postcode;
        _state = (addr.state.isNotEmpty && kMalaysianStates.contains(addr.state)) ? addr.state : null;
        _autoFilled = true;
      }
    });
    _emit();
  }

  // postcode → auto-fill city + state from the offline dataset (authoritative)
  Future<void> _onPostcode(String v) async {
    final code = v.trim();
    if (_autoFilled) {
      setState(() { _city.clear(); _state = null; _autoFilled = false; });
    }
    _emit();
    if (!RegExp(r'^\d{5}$').hasMatch(code)) return;
    final loc = await PostcodeService.instance.lookup(code);
    if (!mounted || loc == null || _postcode.text.trim() != code) return;
    setState(() {
      _city.text = loc.city;
      if (kMalaysianStates.contains(loc.state)) _state = loc.state;
      _autoFilled = true;
    });
    _emit();
  }

  @override
  Widget build(BuildContext context) {
    final e = widget.errors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _line1,
          onChanged: _onLine1,
          maxLength: 255,
          decoration: InputDecoration(
            labelText: 'Address line',
            hintText: 'Unit, street, building, area',
            border: const OutlineInputBorder(),
            errorText: e.line1,
            counterText: '',
            suffixIcon: _line1.text.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close),
                    tooltip: 'Clear',
                    onPressed: _clearLine1,
                  ),
          ),
        ),
        if (_suggestions.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                for (final s in _suggestions)
                  ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    leading: Icon(Icons.location_on_outlined,
                        size: 18, color: Theme.of(context).colorScheme.primary),
                    title: Text(s.description, style: const TextStyle(fontSize: 13)),
                    onTap: () => _pick(s),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(
                controller: _postcode,
                onChanged: _onPostcode,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(5),
                ],
                decoration: InputDecoration(
                  labelText: 'Postcode',
                  border: const OutlineInputBorder(),
                  errorText: e.postcode,
                  counterText: '',
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 2,
              child: TextField(
                controller: _city,
                onChanged: (_) => _emit(),
                maxLength: 100,
                decoration: InputDecoration(
                  labelText: 'City',
                  border: const OutlineInputBorder(),
                  errorText: e.city,
                  counterText: '',
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _state,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: 'State',
            border: const OutlineInputBorder(),
            errorText: e.state,
          ),
          items: [
            for (final s in kMalaysianStates) DropdownMenuItem(value: s, child: Text(s)),
          ],
          onChanged: (v) { setState(() => _state = v); _emit(); },
        ),
      ],
    );
  }
}
