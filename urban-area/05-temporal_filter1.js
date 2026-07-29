/*
================================================================================
MAPBIOMAS MEXICO — TEMPORAL FILTER 1 (TEMPORAL CONSISTENCY)
Collection 1 · v0.01
================================================================================
Description:
  Merges Centro Norte and Centro Sur spatially-filtered classifications into
  a single national mosaic, then applies a temporal consistency filter per
  year: a pixel is kept as urban only if it agrees with a majority of its
  neighboring years within a moving window, removing isolated single-year
  noise from the time series. Outputs one multiband asset (1985-2025,
  41 bands) covering the whole country.

Temporal filter rules (per pixel, per year):
  - First 2 years:  urban if ≥2 of 3 (current + next 2 years)
  - Last 2 years:   urban if ≥2 of 3 (previous 2 years + current)
  - Middle years:   urban if ≥3 of 5 (2 years before/after, centered)

Input zones:
  - Centro Sur   (cells 137-219): Classification/urban_spatial_filtered_*
  - Centro Norte (cells 1-136):   SpatialFilter/urban_spatial_filtered_centro_norte_*
  Both zones are mosaicked per year before the temporal filter is applied
  (Centro Norte on top, per ee.ImageCollection.mosaic() list order — see
  loadSpatialFiltered).

Critical conventions:
- KNOWN LIMITATION (to fix in Collection 2): the try/catch blocks around
  ee.Image(...).select(...) in loadSpatialFiltered/loadSpatialFilteredRaw
  do NOT reliably catch missing-asset errors, since these EE calls are lazy
  and only fail server-side at export time. A missing year/zone asset will
  surface as an export failure on the full multiband image, not as a
  per-zone warning during script execution — harder to trace than in the
  per-cell pipelines upstream.
- SKIP_EXISTING defaults to true here; since this script produces a single
  national asset (not one per cell), toggle it off explicitly when a
  re-export is intended.
- URBAN_VALUE = 24 matches the reclassification convention from the spatial
  filter step (0 = non-urban, 24 = urban, 27 = no-data).

Output:
  - .../Temporal_Filter_1/urban_temporal_filter1_{yearStart}_{yearEnd}_v{version}
================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var version    = 1;
var YEAR_START = 1985;
var YEAR_END   = 2025;
var SKIP_EXISTING = true;

// ============================================================================
// ASSET PATHS
// ============================================================================

var paths = {
  input_centro_sur:   'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Classification/',
  input_centro_norte: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/SpatialFilter/',
  output:             'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_1/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) { YEARS.push(y); }

var FIRST_YEARS = [YEARS[0], YEARS[1]];
var LAST_YEARS  = [YEARS[YEARS.length - 2], YEARS[YEARS.length - 1]];

var URBAN_VALUE   = 24;
var MEXICO_GEOMETRY = ee.Geometry.Rectangle([-118.5, 14.5, -86.5, 32.8]);

// ============================================================================
// NAMING HELPERS
// ============================================================================

/** Centro Sur asset (cells 137–219): Classification/ */
function inputAssetName_CentroSur(year) {
  return 'urban_spatial_filtered_' + year +
         '_v' + version +
         '_' + YEAR_START + '_' + YEAR_END;
}

/** Centro Norte asset (cells 1–136): SpatialFilter/ */
function inputAssetName_CentroNorte(year) {
  return 'urban_spatial_filtered_centro_norte_' + year +
         '_v' + version +
         '_' + YEAR_START + '_' + YEAR_END;
}

/** Output asset name (whole country). */
function outputAssetName() {
  return 'urban_temporal_filter1_' +
         YEAR_START + '_' + YEAR_END +
         '_v' + version;
}

// ============================================================================
// DISCOVERY OF EXISTING ASSETS
// ============================================================================

function listAllAssets(folder) {
  var allAssets = [];
  var pageToken = null;
  var iterations = 0;
  var MAX_ITER = 20;
  do {
    var result = pageToken
      ? ee.data.listAssets(folder, {pageToken: pageToken})
      : ee.data.listAssets(folder);
    allAssets = allAssets.concat(result.assets || []);
    pageToken = result.nextPageToken;
    iterations++;
  } while (pageToken && iterations < MAX_ITER);
  return allAssets;
}

print('═══════════════════════════════════════════════════════');
print('  FILTRO TEMPORAL 1 — MAPBIOMAS MÉXICO (todo el país)');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Output: ' + paths.output + outputAssetName());
print('═══════════════════════════════════════════════════════');

var outputAlreadyExists = false;
if (SKIP_EXISTING) {
  try {
    var existingAssets = listAllAssets(paths.output);
    var existingNames  = existingAssets.map(function(a) {
      return a.id.split('/').pop();
    });
    outputAlreadyExists = existingNames.indexOf(outputAssetName()) !== -1;
    if (outputAlreadyExists) {
      print('⚠ Asset de salida ya existe: ' + outputAssetName());
      print('  Desactivar SKIP_EXISTING para re-exportar.');
    }
  } catch(e) {
    print('Output folder vacío o no existe aún — se exportará.');
  }
}

// ============================================================================
// DATA LOADING — MOSAIC OF BOTH ZONES
// ============================================================================

/**
 * Loads both zones (Centro Norte + Centro Sur) and combines them into a mosaic.
 * Returns a binary image (1 = urban, 0 = non-urban).
 *
 * Mosaic order: Centro Norte on top of Centro Sur.
 * In overlap zones (if any), Centro Norte has priority;
 * adjust the order if the project convention differs.
 */
function loadSpatialFiltered(year) {
  var imgCentroSur, imgCentroNorte;

  // Centro Sur (cells 137–219)
  try {
    imgCentroSur = ee.Image(paths.input_centro_sur + inputAssetName_CentroSur(year))
      .select('classification')
      .eq(URBAN_VALUE)
      .rename('classification');
  } catch(e) {
    print('  ⚠ Centro Sur no disponible para año ' + year + ' — usando imagen vacía.');
    imgCentroSur = ee.Image(0).rename('classification');
  }

  // Centro Norte (cells 1–136)
  try {
    imgCentroNorte = ee.Image(paths.input_centro_norte + inputAssetName_CentroNorte(year))
      .select('classification')
      .eq(URBAN_VALUE)
      .rename('classification');
  } catch(e) {
    print('  ⚠ Centro Norte no disponible para año ' + year + ' — usando imagen vacía.');
    imgCentroNorte = ee.Image(0).rename('classification');
  }

  // Mosaic: the first image in the collection fills the gaps of the following ones.
  // ee.ImageCollection.mosaic() uses list order: last on top.
  // We put both and let each zone cover its territory without real overlap.
  return ee.ImageCollection([imgCentroSur, imgCentroNorte])
    .mosaic()
    .rename('classification');
}

/**
 * "Raw" version (0/24) for visualization.
 */
function loadSpatialFilteredRaw(year) {
  var imgCentroSur, imgCentroNorte;

  try {
    imgCentroSur = ee.Image(paths.input_centro_sur + inputAssetName_CentroSur(year))
      .select('classification');
  } catch(e) {
    imgCentroSur = ee.Image(0).rename('classification');
  }

  try {
    imgCentroNorte = ee.Image(paths.input_centro_norte + inputAssetName_CentroNorte(year))
      .select('classification');
  } catch(e) {
    imgCentroNorte = ee.Image(0).rename('classification');
  }

  return ee.ImageCollection([imgCentroSur, imgCentroNorte])
    .mosaic()
    .rename('classification');
}

// ============================================================================
// TEMPORAL FILTER LOGIC
// ============================================================================

function applyTemporalFilter(year) {
  var current = loadSpatialFiltered(year);
  var temporalMask;
  var windowDesc;

  if (FIRST_YEARS.indexOf(year) !== -1) {
    var f1 = loadSpatialFiltered(year + 1);
    var f2 = loadSpatialFiltered(year + 2);
    temporalMask = ee.ImageCollection([current, f1, f2]).sum().gte(2);
    windowDesc   = 'inicial [' + year + '–' + (year + 2) + '] ≥2 de 3';

  } else if (LAST_YEARS.indexOf(year) !== -1) {
    var l2 = loadSpatialFiltered(year - 2);
    var l1 = loadSpatialFiltered(year - 1);
    temporalMask = ee.ImageCollection([l2, l1, current]).sum().gte(2);
    windowDesc   = 'final [' + (year - 2) + '–' + year + '] ≥2 de 3';

  } else {
    var p2 = loadSpatialFiltered(year - 2);
    var p1 = loadSpatialFiltered(year - 1);
    var n1 = loadSpatialFiltered(year + 1);
    var n2 = loadSpatialFiltered(year + 2);
    temporalMask = ee.ImageCollection([p2, p1, current, n1, n2]).sum().gte(3);
    windowDesc   = 'intermedio [' + (year - 2) + '–' + (year + 2) + '] ≥3 de 5';
  }

  var filtered = temporalMask
    .multiply(current)
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .set({
      'year':             year,
      'temporal_window':  windowDesc,
      'filter_stage':     'temporal_1'
    })
    .toInt8();

  print('  Año ' + year + ' (' + windowDesc + ')');
  return filtered;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

function buildMultibandImage() {
  print('──────────────────────────────────────────');
  print('Aplicando filtro temporal a ' + YEARS.length + ' años…');

  var bands = YEARS.map(function(year) {
    return applyTemporalFilter(year);
  });

  var multibandImage = ee.Image.cat(bands)
    .set({
      'collection_id':          '1',
      'version':                version,
      'territory':              'MEXICO',
      'theme':                  'Urban Area',
      'source':                 'MAPBIOMAS MEXICO',
      'filter_type':            'temporal_filter_1',
      'filter_stage':           'temporal_consistency',
      'first_year':             YEAR_START,
      'last_year':              YEAR_END,
      'total_years':            YEARS.length,
      'urban_value':            URBAN_VALUE,
      'zones_merged':           'centro_sur_137-219 + centro_norte_1-136',  // ← new
      'temporal_rules': JSON.stringify({
        'first_years':  'gte_2_of_3_forward_window',
        'middle_years': 'gte_3_of_5_centered_window',
        'last_years':   'gte_2_of_3_backward_window'
      }),
      'spatial_filter_applied': true,
      'system:time_start': ee.Date.fromYMD(YEAR_START, 1, 1).millis(),
      'system:time_end':   ee.Date.fromYMD(YEAR_END, 12, 31).millis()
    });

  print('Imagen multibanda generada — bandas: ' + YEARS.length);
  return multibandImage;
}

// ============================================================================
// EXPORT
// ============================================================================

function exportResult(multibandImage) {
  var name = outputAssetName();

  Export.image.toAsset({
    image:            multibandImage,
    description:      name,
    assetId:          paths.output + name,
    scale:            30,
    region:           MEXICO_GEOMETRY,
    maxPixels:        1e13,
    overwrite:        true,
    pyramidingPolicy: {'.default': 'mode'}
  });

  print('──────────────────────────────────────────');
  print('  → Export encolado: ' + name);
  print('  → Pestaña "Tasks" → Run para iniciar');
}

// ============================================================================
// VISUALIZATION
// ============================================================================

function testVisualize(year) {
  print('──────────────────────────────────────────');
  print('  TEST VISUAL — año ' + year);

  var original = loadSpatialFilteredRaw(year);
  var filtered = applyTemporalFilter(year);

  var removed = original.eq(URBAN_VALUE)
    .subtract(filtered.eq(URBAN_VALUE))
    .rename('removed');

  Map.addLayer(
    original,
    {min: 0, max: URBAN_VALUE, palette: ['000000', '00FF00']},
    'Original_' + year, false
  );
  Map.addLayer(
    filtered,
    {min: 0, max: URBAN_VALUE, palette: ['000000', 'FF0000']},
    'Temporal_Filtered_' + year, true
  );
  Map.addLayer(
    removed.selfMask(),
    {min: 0, max: 1, palette: ['FF8800']},
    'Removed_by_TF1_' + year, true
  );

  Map.setCenter(-102, 23, 5);
  print('  Rojo = filtrado final | Naranja = píxeles eliminados');
}

// ============================================================================
// EXECUTION
// ============================================================================

if (!outputAlreadyExists) {
  var result = buildMultibandImage();
  exportResult(result);
} else {
  print('Sin tareas — asset ya existente. Desactivar SKIP_EXISTING si deseas re-exportar.');
}

print('═══════════════════════════════════════════════════════');

// ── Testing ──────────────────────────────────────────────────────────────────
// testVisualize(2000);
// testVisualize(1986);
// testVisualize(2025);