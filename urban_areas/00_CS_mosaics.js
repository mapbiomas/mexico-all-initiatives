/*
================================================================================
MAPBIOMAS MEXICO - BASE MOSAICS, SOUTH-CENTRAL REGION
Collection 1 - Urban theme
================================================================================
Description:
Generates annual base mosaics for the South-Central (Centro-Sur) subzone of the
geostatistical grid, using the mosaic production module inherited from
MapBiomas Brasil (Col10):
  users/edimilsonrodriguessantos/mapbiomas:Col10/classificacao/mosaic_production.js

Each mosaic is built per year via mosaicProd.mosaicGen(year, region) and
clipped to the subzone geometry before export.

Mosaic content (42 bands, generated inside mosaicGen — not computed here):
  - 6 raw reflectance bands (BLUE, GREEN, RED, NIR, SWIR1, SWIR2)
  - ~15 spectral indices (vegetation, water, built-up/urban, soil, burn)
  - Spectral mixture analysis (SMA) fractions from two independent unmixing
    models (GV/NPV/SOIL/CLOUD/SHADE/GVS, and SUBS/VEG/DARK)
  - Temporal statistics (p10/p25/p75/p90 percentiles and amplitude) for
    selected indices (EVI, EVI2, EBBI), summarizing intra-annual variability
  For full band-by-band definitions, formulas and sources, see ATBD (Algorithm
  Theoretical Basis Document).

Critical conventions:
- Subzone filter: gridMx.filter(ee.Filter.eq('subzonas', SUBZONA))
- Region geometry is taken from the filtered grid, not the full grid
- Metadata (year, version, territory, theme, collection, subzona) is
  attached via .set() on export for downstream queryability
- pyramidingPolicy: 'mean' (appropriate for continuous reflectance values)

Years covered: 1985–2025

Output:
  projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/MOSAICS/CENTRO-SUR/
================================================================================
*/

// Modules
var mosaicProd = require("users/edimilsonrodriguessantos/mapbiomas:Col10/classificacao/mosaic_production.js");

// ============================================================================
// PARAMETERS
// ============================================================================
var version = 1;

// Output folder
var dirout = 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/MOSAICS/CENTRO-SUR';

// Mosaic area: full geostatistical grid, filtered below to this subzone only.
// The grid carries a 'subzonas' attribute used to split the country into
// processing regions (centro-sur, centro-norte, etc.)
var gridMx = ee.FeatureCollection(
  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos'
);

// Subzone within the grid
var SUBZONA = 'centro-sur';

// Short name for export
var regionName = 'centro_sur';

var gridCentroSur = gridMx.filter(ee.Filter.eq('subzonas', SUBZONA));

var region = gridCentroSur.geometry();

// Full time series to process: one mosaic per year, 1985-2025
var activeYears = ee.List.sequence(1985, 2025).getInfo();

// ============================================================================
// OPTIONAL VISUALIZATION
// ============================================================================
// Quick visual check of a single year's mosaic before launching the full
// export loop below. Uncomment to inspect natural-color rendering and
// confirm the subzone geometry looks correct on the map.
/*
var test_year = 1985;
var testMosaic = mosaicProd.mosaicGen(test_year, region);

Map.centerObject(gridCentroSur, 6);
Map.addLayer(gridCentroSur, {color: 'red'}, 'Subzone');
Map.addLayer(
  testMosaic.clip(region),
  {bands: ['RED', 'GREEN', 'BLUE'], min: 1009, max: 1152},
  'Natural color ' + test_year
);
*/

// print('Active years:', activeYears);
// print('Subzone:', SUBZONA);
// print('Number of features:', gridCentroSur.size());

// ============================================================================
// EXPORT
// ============================================================================
// Launches one export task per year. Each mosaic is generated on the fly
// (not precomputed), clipped to the subzone, tagged with metadata, and
// sent to the Tasks tab — tasks must be run manually from there after
// this script executes.
activeYears.forEach(function(year) {
  var mosaic = mosaicProd.mosaicGen(year, region).clip(region);
  var description = 'mosaic_mexico_' + regionName + '_urban_' + year + '_v' + version;
  var assetId = dirout + '/' + description;

  Export.image.toAsset({
    image: mosaic.set({
      'year': year,
      'version': version,
      'territory': 'MEXICO',
      'theme': 'Urban Area',
      'collection': 1,
      'subzona': SUBZONA
    }),
    description: description,
    assetId: assetId,
    region: region,
    scale: 30,
    maxPixels: 1e13,
    pyramidingPolicy: {'.default': 'mean'}
  });

  print('Tarea lanzada:', description);
});
