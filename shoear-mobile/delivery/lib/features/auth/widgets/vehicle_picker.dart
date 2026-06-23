import 'package:flutter/material.dart';

import 'package:delivery/features/auth/services/vehicle_lookup_service.dart';

/// Brand + model pickers backed by the NHTSA vPIC API. Writes the chosen
/// values into the supplied [brand] / [model] controllers so the parent form's
/// existing validation keeps working unchanged.
///
/// Each picker is a dropdown of API results with an "Other (type manually)"
/// escape hatch. If the lookup fails (offline, rate-limited) the field falls
/// back to free text automatically, so registration is never blocked. Models
/// depend on the brand and reload whenever it changes; everything resets when
/// the [vehicleType] changes.
class VehiclePicker extends StatefulWidget {
  final String vehicleType;
  final TextEditingController brand;
  final TextEditingController model;
  final String? brandError;
  final String? modelError;
  final VoidCallback? onBrandChanged;
  final VoidCallback? onModelChanged;

  const VehiclePicker({
    super.key,
    required this.vehicleType,
    required this.brand,
    required this.model,
    this.brandError,
    this.modelError,
    this.onBrandChanged,
    this.onModelChanged,
  });

  @override
  State<VehiclePicker> createState() => _VehiclePickerState();
}

class _VehiclePickerState extends State<VehiclePicker> {
  final _service = VehicleLookupService();
  static const _other = '__other__';

  List<String>? _brands;
  List<String>? _models;
  bool _loadingBrands = true; // a brand load is kicked off in initState
  bool _loadingModels = false;
  bool _brandManual = false;
  bool _modelManual = false;

  @override
  void initState() {
    super.initState();
    // NOTE: never setState() synchronously here — these helpers only call
    // setState after their first await, so the leading loading flags are set
    // by direct assignment instead (safe before the first build).
    _loadBrands();
    // Editing an existing courier: a brand may already be set — preload models.
    if (widget.brand.text.trim().isNotEmpty) {
      _loadingModels = true;
      _loadModels(widget.brand.text.trim());
    }
  }

  @override
  void didUpdateWidget(VehiclePicker old) {
    super.didUpdateWidget(old);
    if (old.vehicleType != widget.vehicleType) {
      // Type changed → the brand list is stale; clear and reload from scratch.
      // didUpdateWidget triggers a rebuild on its own, so assign directly.
      widget.brand.clear();
      widget.model.clear();
      _brands = null;
      _models = null;
      _loadingBrands = true;
      _loadingModels = false;
      _brandManual = false;
      _modelManual = false;
      // Don't call onBrand/ModelChanged here — it's the parent's setState and
      // we're inside the parent's build. Brand/model re-validate on submit.
      _loadBrands();
    }
  }

  Future<void> _loadBrands() async {
    try {
      final makes = await _service.makesForType(widget.vehicleType);
      if (!mounted) return;
      setState(() {
        _brands = makes;
        _loadingBrands = false;
        // Editing: a saved brand the API doesn't list → show it as manual text.
        final current = widget.brand.text.trim();
        if (current.isNotEmpty && !makes.contains(current)) _brandManual = true;
      });
    } catch (_) {
      if (!mounted) return;
      // Lookup failed → fall back to manual entry rather than block the user.
      setState(() {
        _brands = null;
        _loadingBrands = false;
        _brandManual = true;
      });
    }
  }

  Future<void> _loadModels(String make) async {
    try {
      final models = await _service.modelsForMake(widget.vehicleType, make);
      if (!mounted) return;
      setState(() {
        // No models catalogued for this brand → drop straight to manual entry.
        if (models.isEmpty) {
          _models = null;
          _loadingModels = false;
          _modelManual = true;
          return;
        }
        _models = models;
        _loadingModels = false;
        // Editing: a saved model not in the list → show it as manual text.
        final current = widget.model.text.trim();
        if (current.isNotEmpty && !models.contains(current)) _modelManual = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _models = null;
        _loadingModels = false;
        _modelManual = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [_brandField(), _modelField()],
    );
  }

  // ── Brand ──
  Widget _brandField() {
    if (_loadingBrands) return _loadingBox('Loading brands…');
    if (_brandManual || _brands == null) {
      return _manualField(
        controller: widget.brand,
        label: 'Vehicle brand',
        hint: 'e.g. Perodua',
        error: widget.brandError,
        onChanged: widget.onBrandChanged,
        canReturnToList: _brands != null,
        onReturnToList: () => setState(() => _brandManual = false),
      );
    }
    final value = _brands!.contains(widget.brand.text) ? widget.brand.text : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DropdownButtonFormField<String>(
        value: value,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: 'Vehicle brand',
          border: const OutlineInputBorder(),
          errorText: widget.brandError,
        ),
        items: [
          ..._brands!.map((b) => DropdownMenuItem(value: b, child: Text(b))),
          const DropdownMenuItem(value: _other, child: Text('Other (type manually)')),
        ],
        onChanged: (v) {
          if (v == _other) {
            setState(() {
              _brandManual = true;
              widget.brand.clear();
              widget.model.clear();
              _models = null;
              _modelManual = false;
            });
            widget.onBrandChanged?.call();
            widget.onModelChanged?.call();
            return;
          }
          if (v == null) return;
          setState(() {
            widget.brand.text = v;
            widget.model.clear();
            _models = null;
            _modelManual = false;
            _loadingModels = true;
          });
          widget.onBrandChanged?.call();
          widget.onModelChanged?.call();
          _loadModels(v);
        },
      ),
    );
  }

  // ── Model (depends on a chosen brand) ──
  Widget _modelField() {
    if (widget.brand.text.trim().isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: InputDecorator(
          decoration: const InputDecoration(
            labelText: 'Vehicle model',
            border: OutlineInputBorder(),
          ),
          child: Text('Select a brand first', style: TextStyle(color: Theme.of(context).hintColor)),
        ),
      );
    }
    if (_loadingModels) return _loadingBox('Loading models…');
    if (_modelManual || _models == null) {
      return _manualField(
        controller: widget.model,
        label: 'Vehicle model',
        hint: 'e.g. Myvi',
        error: widget.modelError,
        onChanged: widget.onModelChanged,
        canReturnToList: _models != null,
        onReturnToList: () => setState(() => _modelManual = false),
      );
    }
    final value = _models!.contains(widget.model.text) ? widget.model.text : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: DropdownButtonFormField<String>(
        value: value,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: 'Vehicle model',
          border: const OutlineInputBorder(),
          errorText: widget.modelError,
        ),
        items: [
          ..._models!.map((m) => DropdownMenuItem(value: m, child: Text(m))),
          const DropdownMenuItem(value: _other, child: Text('Other (type manually)')),
        ],
        onChanged: (v) {
          if (v == _other) {
            setState(() {
              _modelManual = true;
              widget.model.clear();
            });
            widget.onModelChanged?.call();
            return;
          }
          if (v == null) return;
          setState(() => widget.model.text = v);
          widget.onModelChanged?.call();
        },
      ),
    );
  }

  // ── shared bits ──
  Widget _loadingBox(String label) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: InputDecorator(
          decoration: const InputDecoration(border: OutlineInputBorder()),
          child: Row(
            children: [
              const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              const SizedBox(width: 12),
              Text(label),
            ],
          ),
        ),
      );

  Widget _manualField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required String? error,
    required VoidCallback? onChanged,
    required bool canReturnToList,
    required VoidCallback onReturnToList,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller: controller,
          maxLength: 50,
          onChanged: (_) => onChanged?.call(),
          decoration: InputDecoration(
            labelText: label,
            hintText: hint,
            border: const OutlineInputBorder(),
            errorText: error,
            counterText: '',
            suffixIcon: canReturnToList
                ? IconButton(
                    tooltip: 'Choose from list',
                    icon: const Icon(Icons.list),
                    onPressed: onReturnToList,
                  )
                : null,
          ),
        ),
      );
}
