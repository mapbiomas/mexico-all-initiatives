/*
================================================================================
MAPBIOMAS MEXICO — TEMPORAL FILTER 2 (TEMPORAL SMOOTHING)
Collection 1 · v0.01
================================================================================

Description:
  Applies a second smoothing temporal filter to the results of temporal
  filter 1. Removes minor fluctuations and produces smoother time series,
  preserving long-term trends.

Methodology:
  1. Loads the multiband image from temporal filter 1
  2. Applies smoothing rules according to temporal position:
       - Intermediate years (1985–2022): window [current, +1, +2, +3]  ·  >=2 of 4
       - Penultimate years (2023–2024): window [-2, -1, current, +1]   ·  >=2 of 4
       - Last year         (2025):      window [-2, -1, current]        ·  >=1 of 3
  3. Builds a smoothed multiband image
  4. Exports as an asset

Adapted from: MapBiomas Argentina — 07 Temporal Filter 2
             (Luna Schteingart, Gonzalo Dieguez)

Critical conventions:
- getBand() uses server-side ee.Algorithms.If to check for missing bands
  before selecting them — unlike the try/catch pattern used in earlier
  pipeline stages (spatial filter, temporal filter 1), this DOES reliably
  handle a missing year band without needing a client-side try/catch,
  since the check happens as part of the EE computation graph itself.
- The three year-type windows (intermediate/penultimate/last) exist because
  the forward-looking window shrinks as YEAR_END is approached; thresholds
  are relaxed accordingly (2/4 → 2/4 mixed → 1/3) rather than kept fixed,
  to avoid over-penalizing recent years with less future context.
- SKIP_EXISTING defaults to true here; since this script produces a single
  national asset (not one per cell), toggle it off explicitly when a
  re-export is intended.
- URBAN_VALUE = 24 matches the reclassification convention carried over
  from the spatial filter / temporal filter 1 stages.

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
  input:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_1/',
  output: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_2/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) { YEARS.push(y); }

// Partition of years according to availability of the future window
// Intermediate: have 3 future years available → 1985–2022
// Penultimate:  only 1 future year available   → 2023, 2024
// Last:         no future years                → 2025
var INTERMEDIATE_YEARS = YEARS.slice(0, YEARS.length - 3); // 1985–2022
var PENULTIMATE_YEARS  = YEARS.slice(YEARS.length - 3, YEARS.length - 1); // 2023, 2024
var LAST_YEAR          = YEARS[YEARS.length - 1]; // 2025

var URBAN_VALUE    = 24;
var MEXICO_GEOMETRY = ee.Geometry.Rectangle([-118.5, 14.5, -86.5, 32.8]);

// ============================================================================
// NAMING
// ============================================================================

function inputAssetName() {
  return 'urban_temporal_filter1_' + YEAR_START + '_' + YEAR_END + '_v' + version;
}

function outputAssetName() {
  return 'urban_temporal_filter2_' + YEAR_START + '_' + YEAR_END + '_v' + version;
}

// ============================================================================
// HELPERS
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

// ============================================================================
// HEADER
// ============================================================================

print('═══════════════════════════════════════════════════════');
print('  FILTRO TEMPORAL 2 — MAPBIOMAS MÉXICO');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Input:  ' + paths.input  + inputAssetName());
print('  Output: ' + paths.output + outputAssetName());
print('  Intermedios: ' + INTERMEDIATE_YEARS[0] + '–' + INTERMEDIATE_YEARS[INTERMEDIATE_YEARS.length - 1] +
      '  (' + INTERMEDIATE_YEARS.length + ' años)');
print('  Penúltimos:  ' + PENULTIMATE_YEARS[0] + ', ' + PENULTIMATE_YEARS[1]);
print('  Último:      ' + LAST_YEAR);
print('═══════════════════════════════════════════════════════');

// ============================================================================
// CHECK SKIP_EXISTING
// ============================================================================

var outputAlreadyExists = false;
if (SKIP_EXISTING) {
  try {
    var existingAssets = listAllAssets(paths.output);
    var existingNames  = existingAssets.map(function(a) { return a.id.split('/').pop(); });
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
// LOAD THE INPUT
// ============================================================================

var tf1Image = ee.Image(paths.input + inputAssetName());
print('──────────────────────────────────────────');
print('Imagen Filtro Temporal 1 cargada.');

/**
 * Returns the band of a year as a binary image (0/1).
 * Uses server-side ee.Algorithms.If to handle missing bands
 * without breaking the client flow.
 */
function getBand(year) {
  var bandName = 'classification_' + year;
  var hasBand  = tf1Image.bandNames().contains(bandName);
  return ee.Image(ee.Algorithms.If(
    hasBand,
    tf1Image.select(bandName).eq(URBAN_VALUE).rename('urban'),
    ee.Image(0).rename('urban')
  ));
}

// ============================================================================
// TEMPORAL FILTER 2 — LOGIC BY YEAR TYPE
// ============================================================================

/**
 * Intermediate years (1985–2022)
 * Forward window: [current, +1, +2, +3]  ·  >=2 of 4
 *
 * Logic: a pixel that is urban this year must be confirmed at least
 * once more in the next three years. Removes flickering and
 * appearances without continuity.
 */
function processIntermediate(year) {
  var y0 = getBand(year);
  var y1 = getBand(year + 1);
  var y2 = getBand(year + 2);
  var y3 = getBand(year + 3);

  var mask = ee.ImageCollection([y0, y1, y2, y3]).sum().gte(2);

  return mask.multiply(y0)
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .toInt8()
    .set({
      'year':        year,
      'filter_type': 'intermediate',
      'rule':        'gte_2_of_4_forward',
      'window':      [year, year + 1, year + 2, year + 3]
    });
}

/**
 * Penultimate years (2023 and 2024)
 * Mixed window: [-2, -1, current, +1]  ·  >=2 of 4
 *
 * Logic: there are no longer 3 future years available; they are compensated
 * with 2 years of past history. The threshold stays at >=2 of 4.
 */
function processPenultimate(year) {
  var ym2 = getBand(year - 2);
  var ym1 = getBand(year - 1);
  var y0  = getBand(year);
  var y1  = getBand(year + 1);

  var mask = ee.ImageCollection([ym2, ym1, y0, y1]).sum().gte(2);

  return mask.multiply(y0)
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .toInt8()
    .set({
      'year':        year,
      'filter_type': 'penultimate',
      'rule':        'gte_2_of_4_mixed',
      'window':      [year - 2, year - 1, year, year + 1]
    });
}

/**
 * Last year (2025)
 * Backward window: [-2, -1, current]  ·  >=1 of 3  (very permissive)
 *
 * Logic: with no future data, we can only look backward.
 * The threshold drops to >=1 of 3 to preserve recent urban expansion
 * that does not yet have enough temporal confirmation.
 * In practice, this is equivalent to keeping almost everything that
 * filter 1 let through for this year.
 */
function processLast(year) {
  var ym2 = getBand(year - 2);
  var ym1 = getBand(year - 1);
  var y0  = getBand(year);

  var mask = ee.ImageCollection([ym2, ym1, y0]).sum().gte(1);

  return mask.multiply(y0)
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .toInt8()
    .set({
      'year':        year,
      'filter_type': 'last',
      'rule':        'gte_1_of_3_backward_permissive'
    });
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

function buildMultibandImage() {
  print('──────────────────────────────────────────');
  print('Aplicando filtro temporal 2…');
  print('  Intermedios (' + INTERMEDIATE_YEARS.length + ' años): ≥2 de 4, ventana →');
  print('  Penúltimos  (' + PENULTIMATE_YEARS.length  + ' años): ≥2 de 4, ventana mixta');
  print('  Último      (1 año):  ≥1 de 3, ventana ←');

  var bands = [];

  // Intermediate
  INTERMEDIATE_YEARS.forEach(function(year) {
    bands.push(processIntermediate(year));
  });

  // Penultimate
  PENULTIMATE_YEARS.forEach(function(year) {
    bands.push(processPenultimate(year));
  });

  // Last
  bands.push(processLast(LAST_YEAR));

  var multibandImage = ee.Image.cat(bands)
    .set({
      'collection_id':          '1',
      'version':                version,
      'territory':              'MEXICO',
      'theme':                  'Urban Area',
      'source':                 'MAPBIOMAS MEXICO',
      'filter_type':            'temporal_filter_2',
      'filter_stage':           'temporal_smoothing',
      'input_filter':           'temporal_filter_1',
      'first_year':             YEAR_START,
      'last_year':              YEAR_END,
      'total_years':            YEARS.length,
      'n_intermediate':         INTERMEDIATE_YEARS.length,
      'n_penultimate':          PENULTIMATE_YEARS.length,
      'n_last':                 1,
      'urban_value':            URBAN_VALUE,
      'rules': JSON.stringify({
        'intermediate': 'gte_2_of_4_forward_window',
        'penultimate':  'gte_2_of_4_mixed_window',
        'last':         'gte_1_of_3_backward_permissive'
      }),
      'system:time_start': ee.Date.fromYMD(YEAR_START, 1, 1).millis(),
      'system:time_end':   ee.Date.fromYMD(YEAR_END,   12, 31).millis()
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
    overwrite: true,
    pyramidingPolicy: {'.default': 'mode'}
  });

  print('──────────────────────────────────────────');
  print('  → Export encolado: ' + name);
  print('  → Pestaña "Tasks" → Run para iniciar');
}

// ============================================================================
// VISUALIZATION (DIAGNOSTIC)
// ============================================================================

/**
 * Compares filter 1 vs filter 2 for a given year.
 * Call manually: testVisualize(2000);
 */
function testVisualize(year) {
  print('──────────────────────────────────────────');
  print('  TEST VISUAL — año ' + year);

  // Determine the year type
  var yearType;
  if (INTERMEDIATE_YEARS.indexOf(year) !== -1) {
    yearType = 'intermedio  [' + year + '–' + (year + 3) + '] ≥2 de 4';
  } else if (PENULTIMATE_YEARS.indexOf(year) !== -1) {
    yearType = 'penúltimo   [' + (year - 2) + '–' + (year + 1) + '] ≥2 de 4';
  } else if (year === LAST_YEAR) {
    yearType = 'último      [' + (year - 2) + '–' + year + '] ≥1 de 3';
  } else {
    print('  ⚠ Año ' + year + ' fuera del rango ' + YEAR_START + '–' + YEAR_END);
    return;
  }
  print('  Tipo: ' + yearType);

  // Load bands
  var bandName = 'classification_' + year;
  var tf1Band  = tf1Image.select(bandName); // input (post filter 1)

  // Compute the filter 2 output for this year
  var tf2Band;
  if (INTERMEDIATE_YEARS.indexOf(year) !== -1) {
    tf2Band = processIntermediate(year);
  } else if (PENULTIMATE_YEARS.indexOf(year) !== -1) {
    tf2Band = processPenultimate(year);
  } else {
    tf2Band = processLast(year);
  }

  // Pixels removed by filter 2
  var removed = tf1Band.eq(URBAN_VALUE)
    .subtract(tf2Band.eq(URBAN_VALUE))
    .rename('removed');

  Map.addLayer(
    tf1Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', '00FF00']},
    'TF1_' + year, false
  );
  Map.addLayer(
    tf2Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', 'FF0000']},
    'TF2_' + year, true
  );
  Map.addLayer(
    removed.selfMask(),
    {min: 0, max: 1, palette: ['FFFF00']},
    'Removed_by_TF2_' + year, true
  );

  Map.setCenter(-102, 23, 5);
  print('  Verde = post-TF1 | Rojo = post-TF2 | Amarillo = eliminado por TF2');
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

// ============================================================================
// TESTING — uncomment to test individual years without exporting
// ============================================================================

// testVisualize(2000);   // intermediate year
// testVisualize(2023);   // penultimate year
// testVisualize(2024);   // penultimate year
// testVisualize(2025);   // last year