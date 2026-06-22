import 'dart:convert';

import 'package:http/http.dart' as http;

/// Looks up vehicle makes/models from the free NHTSA vPIC API
/// (https://vpic.nhtsa.dot.gov/api/). No API key or registration required.
///
/// NHTSA's dataset is US-market, so a few local-only brands may be missing —
/// the UI that consumes this always offers a "type manually" fallback so a
/// courier is never blocked from registering.
class VehicleLookupService {
  static const _base = 'https://vpic.nhtsa.dot.gov/api/vehicles';

  // Map our vehicle-type labels to the type names NHTSA understands. NHTSA has
  // no dedicated "Van" type — vans sit under Truck — so we map both there.
  static const Map<String, String> _typeForApi = {
    'Motorcycle': 'motorcycle',
    'Car': 'car',
    'Van': 'truck',
    'Truck': 'truck',
  };

  /// All makes for the given vehicle type, de-duplicated and sorted A–Z.
  Future<List<String>> makesForType(String vehicleType) async {
    final apiType = _typeForApi[vehicleType] ?? 'car';
    final uri = Uri.parse('$_base/GetMakesForVehicleType/$apiType?format=json');
    return _names(uri, 'MakeName');
  }

  /// All models for the given make, de-duplicated and sorted A–Z.
  Future<List<String>> modelsForMake(String make) async {
    final uri = Uri.parse('$_base/GetModelsForMake/${Uri.encodeComponent(make)}?format=json');
    return _names(uri, 'Model_Name');
  }

  // Shared fetch: pull `field` out of every row of the `Results` array.
  Future<List<String>> _names(Uri uri, String field) async {
    final res = await http.get(uri).timeout(const Duration(seconds: 12));
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
