/// Vehicle brand/model catalogue for the courier registration form.
///
/// Data is hardcoded rather than fetched from an external API so registration
/// works offline and is not blocked by firewall / CORS restrictions. The lists
/// are curated for the Malaysian market (Perodua, Proton, Modenas, SYM and the
/// most common Japanese/European brands). Unknown or niche brands are handled
/// by the VehiclePicker's "Other (type manually)" escape hatch.
class VehicleLookupService {
  static const Map<String, List<String>> _brandsByType = {
    'Motorcycle': [
      'Aprilia', 'Benelli', 'BMW', 'Ducati', 'Harley-Davidson', 'Honda',
      'Kawasaki', 'KTM', 'Modenas', 'Royal Enfield', 'Suzuki', 'SYM',
      'Triumph', 'Yamaha',
    ],
    'Car': [
      'Audi', 'BMW', 'BYD', 'Chery', 'Daihatsu', 'Ford', 'Honda', 'Hyundai',
      'Kia', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan', 'Perodua',
      'Proton', 'Subaru', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo',
    ],
    'Van': [
      'Ford', 'Hyundai', 'Maxus', 'Mercedes-Benz', 'Nissan', 'Peugeot',
      'Renault', 'Toyota', 'Volkswagen',
    ],
    'Truck': [
      'DAF', 'Hino', 'Isuzu', 'MAN', 'Mercedes-Benz', 'Mitsubishi Fuso',
      'Nissan', 'Renault', 'Scania', 'Toyota', 'Volvo',
    ],
  };

  static const Map<String, Map<String, List<String>>> _modelsByTypeAndBrand = {
    'Motorcycle': {
      'Honda': [
        'CB150R', 'CB500F', 'CB650R', 'CBR150R', 'CBR250RR', 'CBR600RR',
        'CRF150L', 'EX5 Dream', 'Revo', 'RS150R', 'Vario 150', 'Wave 110',
        'Wave Alpha', 'Winner X',
      ],
      'Yamaha': [
        'Crypton', 'Ego Avantiz', 'Ego S', 'Exciter 150', 'FZ25', 'LC135',
        'MT-07', 'MT-09', 'MT-15', 'NMax 155', 'R15', 'R25', 'XMax 250',
        'Y15ZR',
      ],
      'Kawasaki': [
        'Ninja 250', 'Ninja 400', 'Ninja 650', 'Ninja ZX-10R', 'Ninja ZX-6R',
        'Versys 650', 'W175', 'Z400', 'Z650', 'Z900',
      ],
      'Suzuki': [
        'Address 115', 'Belang R150', 'Burgman 400', 'GSX-R150', 'GSX-S150',
        'Hayabusa', 'Raider R150', 'Skydrive 125',
      ],
      'Modenas': [
        'Boss 185', 'CT100B', 'Dominar 400', 'Elegan 250', 'GT128',
        'Kriss 110', 'Kriss 110R', 'V15',
      ],
      'SYM': [
        'Bonus 110', 'CITYCOM S 300i', 'Fiamma 50', 'Jet14 200',
        'Sport Rider 150', 'VF3i 185',
      ],
      'KTM': ['200 Duke', '390 Adventure', '390 Duke', '690 Duke', '890 Duke'],
      'Benelli': ['302R', '502C', 'TNT 135', 'TNT 249S', 'TNT 302'],
      'BMW': ['G 310 GS', 'G 310 R', 'R 1250 GS', 'S 1000 RR'],
      'Ducati': ['Monster 937', 'Panigale V2', 'Panigale V4', 'Scrambler 800'],
      'Harley-Davidson': [
        'Fat Bob', 'Fat Boy', 'Iron 883', 'Road King', 'Street 750',
      ],
      'Royal Enfield': [
        'Classic 350', 'Himalayan', 'Meteor 350', 'Thunderbird X',
      ],
      'Triumph': [
        'Bonneville T100', 'Speed Triple', 'Street Triple', 'Tiger 900',
      ],
      'Aprilia': ['RS 660', 'RS4 125', 'Tuono 660'],
    },
    'Car': {
      'Perodua': [
        'Ativa', 'Axia', 'Bezza', 'Kancil', 'Kelisa', 'Kenari', 'Kembara',
        'Myvi', 'Nautica', 'Viva',
      ],
      'Proton': [
        'Ertiga', 'Exora', 'Gen-2', 'Iriz', 'Perdana', 'Persona', 'Preve',
        'Saga', 'Satria Neo', 'Suprima S', 'Waja', 'Wira', 'X50', 'X70',
        'X90',
      ],
      'Toyota': [
        'Alphard', 'Altis', 'Avanza', 'C-HR', 'Camry', 'Corolla Cross',
        'Fortuner', 'GR86', 'Harrier', 'Vellfire', 'Veloz', 'Vios', 'Yaris',
      ],
      'Honda': [
        'Accord', 'BR-V', 'City', 'City Hatchback', 'Civic', 'CR-V', 'HR-V',
        'Jazz', 'Odyssey', 'WR-V',
      ],
      'Nissan': [
        'Almera', 'Grand Livina', 'Kicks', 'Navara', 'Note', 'Serena',
        'X-Trail',
      ],
      'Mitsubishi': [
        'ASX', 'Eclipse Cross', 'Outlander', 'Pajero Sport', 'Xpander',
      ],
      'Mazda': [
        'CX-3', 'CX-30', 'CX-5', 'CX-60', 'CX-8', 'Mazda2', 'Mazda3',
        'Mazda6', 'MX-5',
      ],
      'Hyundai': [
        'Elantra', 'i10', 'i20', 'Ioniq 5', 'Ioniq 6', 'Kona', 'Santa Fe',
        'Tucson',
      ],
      'Kia': ['Carnival', 'EV6', 'Niro', 'Seltos', 'Sonet', 'Sorento', 'Sportage'],
      'Suzuki': ['Baleno', 'Ertiga', 'Ignis', 'Jimny', 'Swift', 'Vitara'],
      'Mercedes-Benz': [
        'A-Class', 'C-Class', 'CLA', 'E-Class', 'GLA', 'GLC', 'GLE',
        'S-Class',
      ],
      'BMW': [
        '1 Series', '2 Series', '3 Series', '5 Series', '7 Series', 'X1',
        'X3', 'X5',
      ],
      'Audi': ['A3', 'A4', 'A6', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8'],
      'Volkswagen': ['Golf', 'Passat', 'Polo', 'Tiguan'],
      'Volvo': ['S60', 'S90', 'XC40', 'XC60', 'XC90'],
      'Ford': ['EcoSport', 'Everest', 'Fiesta', 'Focus', 'Mustang', 'Ranger'],
      'Subaru': ['BRZ', 'Forester', 'Impreza', 'Outback', 'WRX', 'XV'],
      'Daihatsu': ['Gran Max', 'Rocky', 'Sirion', 'Terios'],
      'BYD': ['Atto 3', 'Dolphin', 'Seal', 'Tang'],
      'Chery': ['Omoda 5', 'Tiggo 5x', 'Tiggo 7 Pro', 'Tiggo 8 Pro'],
    },
    'Van': {
      'Toyota': ['Hiace', 'Hiace Commuter', 'HiAce Super Grandia'],
      'Nissan': ['NV200', 'NV350 Urvan', 'Urvan'],
      'Mercedes-Benz': ['Sprinter', 'Viano', 'Vito'],
      'Ford': ['Transit', 'Transit Connect', 'Transit Custom'],
      'Volkswagen': ['Caravelle', 'Multivan', 'Transporter'],
      'Hyundai': ['H-1', 'Starex', 'Staria'],
      'Maxus': ['G10', 'T60', 'V80'],
      'Renault': ['Master', 'Trafic'],
      'Peugeot': ['Boxer', 'Expert', 'Partner'],
    },
    'Truck': {
      'Isuzu': ['D-Max', 'ELF 150', 'ELF 250', 'Forward', 'FVR', 'NMR', 'NQR', 'NRR'],
      'Hino': ['300 Series', '500 Series', '700 Series'],
      'Mitsubishi Fuso': ['Canter', 'Fighter', 'Rosa', 'Super Great'],
      'MAN': ['TGA', 'TGM', 'TGS', 'TGX'],
      'Scania': ['G Series', 'P Series', 'R Series', 'S Series'],
      'Mercedes-Benz': ['Actros', 'Arocs', 'Atego', 'Axor'],
      'Volvo': ['FH', 'FL', 'FM', 'FMX'],
      'Toyota': ['Hilux', 'Land Cruiser 70'],
      'Nissan': ['Navara', 'NT400', 'NT500'],
      'DAF': ['CF', 'LF', 'XF'],
      'Renault': ['C-Range', 'D-Range', 'K-Range', 'T-Range'],
    },
  };

  /// Brands for the given vehicle type, sorted A–Z.
  Future<List<String>> makesForType(String vehicleType) async {
    return List<String>.from(_brandsByType[vehicleType] ?? []);
  }

  /// Models for the given type + brand combination, sorted A–Z.
  /// Returns an empty list when the brand is not in the catalogue; the
  /// VehiclePicker will automatically switch to a free-text field instead.
  Future<List<String>> modelsForMake(String vehicleType, String make) async {
    return List<String>.from(
        _modelsByTypeAndBrand[vehicleType]?[make] ?? []);
  }
}
