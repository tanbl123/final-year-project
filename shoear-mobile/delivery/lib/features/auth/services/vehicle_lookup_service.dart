import 'dart:convert';

import 'package:http/http.dart' as http;

/// Fetches vehicle makes/models from the NHTSA vPIC API
/// (https://vpic.nhtsa.dot.gov/api/). No API key required.
///
/// NHTSA is US-market only, so Malaysian brands (Perodua, Proton, Modenas,
/// SYM) are supplemented from a small local list and merged into the results.
/// If the API is unreachable the local brands are returned as a fallback so
/// Malaysian couriers are never blocked from registering.
class VehicleLookupService {
  static const _base = 'https://vpic.nhtsa.dot.gov/api/vehicles';

  static const Map<String, String> _typeForApi = {
    'Motorcycle': 'motorcycle',
    'Car': 'car',
    'Van': 'truck',
    'Truck': 'truck',
  };

  // Malaysian/regional brands absent from the NHTSA (US-only) database.
  static const Map<String, List<String>> _localBrands = {
    'Motorcycle': ['Modenas', 'SYM'],
    'Car': ['Perodua', 'Proton'],
    'Van': [],
    'Truck': [],
  };

  // Models for brands that NHTSA doesn't carry.
  static const Map<String, List<String>> _localModels = {
    'Modenas': [
      'Boss 185', 'CT100B', 'Dominar 400', 'Elegan 250', 'GT128',
      'Kriss 110', 'Kriss 110R', 'V15',
    ],
    'SYM': [
      'Bonus 110', 'CITYCOM S 300i', 'Fiamma 50', 'Jet14 200',
      'Sport Rider 150', 'VF3i 185',
    ],
    'Perodua': [
      'Ativa', 'Axia', 'Bezza', 'Kancil', 'Kelisa', 'Kenari',
      'Kembara', 'Myvi', 'Nautica', 'Viva',
    ],
    'Proton': [
      'Ertiga', 'Exora', 'Gen-2', 'Iriz', 'Perdana', 'Persona',
      'Preve', 'Saga', 'Satria Neo', 'Suprima S', 'Waja', 'Wira',
      'X50', 'X70', 'X90',
    ],
  };

  /// All makes for the given vehicle type, merging NHTSA results with the
  /// local Malaysian supplement, de-duplicated and sorted A–Z.
  Future<List<String>> makesForType(String vehicleType) async {
    final local = List<String>.from(_localBrands[vehicleType] ?? []);
    try {
      final apiType = _typeForApi[vehicleType] ?? 'car';
      final uri = Uri.parse('$_base/GetMakesForVehicleType/$apiType?format=json');
      final apiMakes = await _names(uri, 'MakeName');
      // Merge API + local, deduplicate, sort A–Z.
      final combined = {...apiMakes, ...local}.toList()
        ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
      return combined;
    } catch (_) {
      // API unreachable — return local brands so the form still works offline.
      return local..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    }
  }

  /// Models for the given make, de-duplicated and sorted A–Z.
  /// Local models (Malaysian brands) take priority over the API.
  /// Returns an empty list when no data is available; VehiclePicker will
  /// automatically switch to a free-text field in that case.
  Future<List<String>> modelsForMake(String vehicleType, String make) async {
    if (_localModels.containsKey(make)) {
      return List<String>.from(_localModels[make]!);
    }
    try {
      final uri = Uri.parse(
          '$_base/GetModelsForMake/${Uri.encodeComponent(make)}?format=json');
      return await _names(uri, 'Model_Name');
    } catch (_) {
      return []; // VehiclePicker treats empty list as "switch to manual entry"
    }
  }

  // Shared fetch helper: pull [field] out of every row of the Results array.
  Future<List<String>> _names(Uri uri, String field) async {
    // NHTSA blocks Dart's default User-Agent, so send a browser-like one.
    final res = await http.get(uri, headers: const {
      'User-Agent': 'Mozilla/5.0 (Linux; Android) ShoeARExpress/1.0',
      'Accept': 'application/json',
    }).timeout(const Duration(seconds: 15));
    if (res.statusCode != 200) {
      throw Exception('Vehicle lookup failed (${res.statusCode}).');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final results = (body['Results'] as List?) ?? const [];
    final names = results
        .map((e) => (e as Map<String, dynamic>)[field]?.toString().trim() ?? '')
        .where((s) => s.isNotEmpty)
        .toSet()
        .toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return names;
  }
}
