// Leaflet publica un build ESM aparte del CommonJS de "main": se importa ese
// para que el bundler no avise por dependencias CommonJS. Mismos tipos.
declare module 'leaflet/dist/leaflet-src.esm.js' {
  export * from 'leaflet';
}
