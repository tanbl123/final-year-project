-- Vehicle catalogue tables.
-- Run this once in phpMyAdmin after schema.sql.
--
-- source='local'  → manually seeded (Malaysian brands). Never deleted.
-- source='nhtsa'  → fetched from the NHTSA API. Replaced on every 30-day
--                   refresh so outdated vehicles are removed automatically.

CREATE TABLE IF NOT EXISTS vehicle_makes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vehicleType ENUM('Motorcycle','Car','Van','Truck') NOT NULL,
  makeName    VARCHAR(100) NOT NULL,
  source      ENUM('local','nhtsa') NOT NULL DEFAULT 'nhtsa',
  UNIQUE KEY uq_type_make (vehicleType, makeName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicle_models (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vehicleType ENUM('Motorcycle','Car','Van','Truck') NOT NULL,
  makeName    VARCHAR(100) NOT NULL,
  modelName   VARCHAR(100) NOT NULL,
  source      ENUM('local','nhtsa') NOT NULL DEFAULT 'nhtsa',
  UNIQUE KEY uq_type_make_model (vehicleType, makeName, modelName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracks when each cache key was last successfully refreshed from NHTSA.
CREATE TABLE IF NOT EXISTS vehicle_cache_log (
  cacheKey  VARCHAR(200) PRIMARY KEY,
  cachedAt  DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seed: brand names (source='local' — safe from NHTSA refresh deletes) ──────
INSERT IGNORE INTO vehicle_makes (vehicleType, makeName, source) VALUES
  ('Motorcycle','Aprilia','local'),('Motorcycle','Benelli','local'),
  ('Motorcycle','BMW','local'),('Motorcycle','Ducati','local'),
  ('Motorcycle','Harley-Davidson','local'),('Motorcycle','Honda','local'),
  ('Motorcycle','Kawasaki','local'),('Motorcycle','KTM','local'),
  ('Motorcycle','Modenas','local'),('Motorcycle','Royal Enfield','local'),
  ('Motorcycle','Suzuki','local'),('Motorcycle','SYM','local'),
  ('Motorcycle','Triumph','local'),('Motorcycle','Yamaha','local'),

  ('Car','Audi','local'),('Car','BMW','local'),('Car','BYD','local'),
  ('Car','Chery','local'),('Car','Daihatsu','local'),('Car','Ford','local'),
  ('Car','Honda','local'),('Car','Hyundai','local'),('Car','Kia','local'),
  ('Car','Mazda','local'),('Car','Mercedes-Benz','local'),
  ('Car','Mitsubishi','local'),('Car','Nissan','local'),('Car','Perodua','local'),
  ('Car','Proton','local'),('Car','Subaru','local'),('Car','Suzuki','local'),
  ('Car','Toyota','local'),('Car','Volkswagen','local'),('Car','Volvo','local'),

  ('Van','Ford','local'),('Van','Hyundai','local'),('Van','Maxus','local'),
  ('Van','Mercedes-Benz','local'),('Van','Nissan','local'),
  ('Van','Peugeot','local'),('Van','Renault','local'),('Van','Toyota','local'),
  ('Van','Volkswagen','local'),

  ('Truck','DAF','local'),('Truck','Hino','local'),('Truck','Isuzu','local'),
  ('Truck','MAN','local'),('Truck','Mercedes-Benz','local'),
  ('Truck','Mitsubishi Fuso','local'),('Truck','Nissan','local'),
  ('Truck','Renault','local'),('Truck','Scania','local'),
  ('Truck','Toyota','local'),('Truck','Volvo','local');

-- ── Seed: Malaysian brand models (source='local' — NHTSA has no data for these)
INSERT IGNORE INTO vehicle_models (vehicleType, makeName, modelName, source) VALUES
  ('Motorcycle','Modenas','Boss 185','local'),
  ('Motorcycle','Modenas','CT100B','local'),
  ('Motorcycle','Modenas','Dominar 400','local'),
  ('Motorcycle','Modenas','Elegan 250','local'),
  ('Motorcycle','Modenas','GT128','local'),
  ('Motorcycle','Modenas','Kriss 110','local'),
  ('Motorcycle','Modenas','Kriss 110R','local'),
  ('Motorcycle','Modenas','V15','local'),

  ('Motorcycle','SYM','Bonus 110','local'),
  ('Motorcycle','SYM','CITYCOM S 300i','local'),
  ('Motorcycle','SYM','Fiamma 50','local'),
  ('Motorcycle','SYM','Jet14 200','local'),
  ('Motorcycle','SYM','Sport Rider 150','local'),
  ('Motorcycle','SYM','VF3i 185','local'),

  ('Car','Perodua','Ativa','local'),('Car','Perodua','Axia','local'),
  ('Car','Perodua','Bezza','local'),('Car','Perodua','Kancil','local'),
  ('Car','Perodua','Kelisa','local'),('Car','Perodua','Kenari','local'),
  ('Car','Perodua','Kembara','local'),('Car','Perodua','Myvi','local'),
  ('Car','Perodua','Nautica','local'),('Car','Perodua','Viva','local'),

  ('Car','Proton','Ertiga','local'),('Car','Proton','Exora','local'),
  ('Car','Proton','Gen-2','local'),('Car','Proton','Iriz','local'),
  ('Car','Proton','Perdana','local'),('Car','Proton','Persona','local'),
  ('Car','Proton','Preve','local'),('Car','Proton','Saga','local'),
  ('Car','Proton','Satria Neo','local'),('Car','Proton','Suprima S','local'),
  ('Car','Proton','Waja','local'),('Car','Proton','Wira','local'),
  ('Car','Proton','X50','local'),('Car','Proton','X70','local'),
  ('Car','Proton','X90','local');
