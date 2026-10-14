-- Mapa (#24): de dónde salen los mosaicos del fondo. 'osm' = servidor
-- público de OpenStreetMap; 'custom' = un servidor propio (map_tiles_url con
-- {z}, {x} e {y}); 'none' = sin fondo, solo la silueta de los países.
ALTER TABLE app_config
  ADD COLUMN map_tiles_mode TEXT NOT NULL DEFAULT 'osm' CHECK (map_tiles_mode IN ('osm', 'custom', 'none')),
  ADD COLUMN map_tiles_url TEXT NOT NULL DEFAULT '';
