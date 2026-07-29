/*
================================================================================
MAPBIOMAS MEXICO — TEMPORAL FILTER 3 (TEMPORAL GAP FILLING)
Collection 1 · v0.01
================================================================================

Description:
  Applies a third temporal filter that fills gaps in the urban time series.
  Unlike the previous filters, which remove pixels, this filter ADDS urban
  pixels by identifying brief interruptions in continuous urban sequences.

  Philosophy: "If there is urban before and after, there was probably urban in between"

Methodology:
  1. Loads the multiband image from temporal filter 2
  2. Applies filling rules according to temporal position:
       - First year   (1985): preserves what exists, no filling possible
       - Intermediate years (1986–2024): previous=urban AND current=non-urban
                                          AND next=urban  →  FILL
       - Last year    (2025): if 2024=urban → mark 2025 as urban
  3. Builds a gap-filled multiband image
  4. Exports as an asset

Key difference from TF1 and TF2:
  TF1 and TF2 remove pixels (result: smaller urban area)
  TF3 adds pixels (result: larger urban area, +2 to +5% expected)

Adapted from: MapBiomas Argentina — 08 Temporal Filter 3
             (Luna Schteingart, Gonzalo Dieguez)

Critical conventions:
- getBand() uses server-side ee.Algorithms.If to check for missing bands
  before selecting them, same pattern as Temporal Filter 2 — reliable
  handling of a missing year band without a client-side try/catch.
- SKIP_EXISTING defaults to true here; since this script produces a single
  national asset (not one per cell), toggle it off explicitly when a
  re-export is intended.
- URBAN_VALUE = 24 matches the reclassification convention carried over
  from the spatial filter / temporal filter 1-2 stages.
- Unlike TF1/TF2 (which only remove pixels, shrinking urban area), TF3
  ADDS pixels by filling one-year gaps — expect urban area to grow by
  roughly +2 to +5% relative to the TF2 input.

================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var version       = 1;
var YEAR_START    = 1985;
var YEAR_END      = 2025;
var SKIP_EXISTING = true;

// ============================================================================
// ASSET PATHS
// ============================================================================

var paths = {
  input:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_2/',
  output: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_3/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) { YEARS.push(y); }

// Partition of years
// First year:    no previous year → only preserve, do not fill  → 1985
// Intermediate:  have previous and next year                     → 1986–2024
// Last year:     no next year → continuity from previous year    → 2025
var FIRST_YEAR         = YEARS[0];                              // 1985
var MIDDLE_YEARS       = YEARS.slice(1, YEARS.length - 1);     // 1986–2024
var LAST_YEAR          = YEARS[YEARS.length - 1];              // 2025

var URBAN_VALUE     = 24;
var MEXICO_GEOMETRY = ee.Geometry.Rectangle([-118.5, 14.5, -86.5, 32.8]);

// ============================================================================
// NAMING
// ============================================================================

function inputAssetName() {
  return 'urban_temporal_filter2_' + YEAR_START + '_' + YEAR_END + '_v' + version;
}

function outputAssetName() {
  return 'urban_temporal_filter3_' + YEAR_START + '_' + YEAR_END + '_v' + version;
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
print('  FILTRO TEMPORAL 3 — MAPBIOMAS MÉXICO');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Input:  ' + paths.input  + inputAssetName());
print('  Output: ' + paths.output + outputAssetName());
print('  Primer año:   ' + FIRST_YEAR + '  (sin relleno)');
print('  Intermedios:  ' + MIDDLE_YEARS[0] + '–' + MIDDLE_YEARS[MIDDLE_YEARS.length - 1] +
      '  (' + MIDDLE_YEARS.length + ' años)');
print('  Último año:   ' + LAST_YEAR + '  (continuidad desde anterior)');
print('  EFECTO: AGREGA píxeles — área urbana aumenta +2 a +5%');
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

var tf2Image = ee.Image(paths.input + inputAssetName());
print('──────────────────────────────────────────');
print('Imagen Filtro Temporal 2 cargada.');

/**
 * Returns the band of a year as a binary image (0/1).
 * Uses server-side ee.Algorithms.If to handle missing bands.
 */
function getBand(year) {
  var bandName = 'classification_' + year;
  var hasBand  = tf2Image.bandNames().contains(bandName);
  return ee.Image(ee.Algorithms.If(
    hasBand,
    tf2Image.select(bandName).eq(URBAN_VALUE).rename('urban'),
    ee.Image(0).rename('urban')
  ));
}

// ============================================================================
// TEMPORAL FILTER 3 — LOGIC BY YEAR TYPE
// ============================================================================

/**
 * First year (1985)
 * No previous year available → gaps cannot be detected.
 * Only preserves what filter 2 let through. The result is
 * identical to the input for this year.
 */
function processFirst() {
  var y0 = getBand(FIRST_YEAR);
  var y1 = getBand(FIRST_YEAR + 1);

  // Preserve the original; the AND condition with the next year is
  // a way to keep only what is persistent, without adding anything new.
  var result = ee.ImageCollection([y0, y0.and(y1)]).sum().gte(1);

  return result
    .multiply(URBAN_VALUE)
    .rename('classification_' + FIRST_YEAR)
    .toInt8()
    .set({
      'year':        FIRST_YEAR,
      'filter_type': 'first',
      'rule':        'preserve_only_no_gap_fill_possible'
    });
}

/**
 * Intermediate years (1986–2024)
 * Core logic of the filter: fills ONE-year-long gaps.
 *
 * Fill condition:
 *   previous year = urban  AND
 *   current year  = non-urban  AND
 *   next year     = urban
 *   → mark current as urban
 *
 * If the current year was already urban, it stays unchanged.
 * No new gaps are created and no pixels are removed.
 */
function processMiddle(year) {
  var prev    = getBand(year - 1);
  var current = getBand(year);
  var next    = getBand(year + 1);

  // Gap detected: flanked by urban but not detected this year
  var gapToFill = prev.and(current.not()).and(next);

  // Result: what was already urban + what gets filled
  var result = ee.ImageCollection([current, gapToFill]).sum().gte(1);

  return result
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .toInt8()
    .set({
      'year':        year,
      'filter_type': 'middle',
      'rule':        'gap_fill_prev_AND_next_urban',
      'effect':      'adds_pixels_fills_temporal_gaps'
    });
}

/**
 * Last year (2025)
 * No next year available → gaps cannot be detected.
 * Permissive rule: if 2024 was urban, continuity into 2025 is assumed.
 *
 * Logic: cities rarely disappear from one year to the next.
 * If the classifier did not detect urban in 2025 but 2024 was urban,
 * it is more likely a detection error than an actual demolition.
 */
function processLast() {
  var prev    = getBand(LAST_YEAR - 1); // 2024
  var current = getBand(LAST_YEAR);    // 2025

  // Result: what was already urban in 2025 + continuity from 2024
  var result = ee.ImageCollection([current, prev]).sum().gte(1);

  return result
    .multiply(URBAN_VALUE)
    .rename('classification_' + LAST_YEAR)
    .toInt8()
    .set({
      'year':        LAST_YEAR,
      'filter_type': 'last',
      'rule':        'prev_urban_continuity_permissive',
      'effect':      'assumes_urban_continuity_from_previous_year'
    });
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

function buildMultibandImage() {
  print('──────────────────────────────────────────');
  print('Aplicando filtro temporal 3 (relleno de huecos)…');
  print('  Primer año  (1 año):  sin relleno — preservar input');
  print('  Intermedios (' + MIDDLE_YEARS.length + ' años): rellenar si prev=urb AND next=urb');
  print('  Último año  (1 año):  continuidad desde año anterior');

  var bands = [];

  // First year
  bands.push(processFirst());

  // Intermediate
  MIDDLE_YEARS.forEach(function(year) {
    bands.push(processMiddle(year));
  });

  // Last year
  bands.push(processLast());

  var multibandImage = ee.Image.cat(bands)
    .set({
      'collection_id':          '1',
      'version':                version,
      'territory':              'MEXICO',
      'theme':                  'Urban Area',
      'source':                 'MAPBIOMAS MEXICO',
      'filter_type':            'temporal_filter_3_gap_fill',
      'filter_stage':           'temporal_gap_filling',
      'input_filter':           'temporal_filter_2',
      'first_year':             YEAR_START,
      'last_year':              YEAR_END,
      'total_years':            YEARS.length,
      'n_first':                1,
      'n_middle':               MIDDLE_YEARS.length,
      'n_last':                 1,
      'urban_value':            URBAN_VALUE,
      'effect':                 'INCREASES_urban_area_by_filling_temporal_gaps',
      'philosophy':             'If urban before and after, probably urban in between',
      'rules': JSON.stringify({
        'first':  'preserve_only_no_gap_fill_possible',
        'middle': 'gap_fill_prev_AND_next_urban',
        'last':   'prev_urban_continuity_permissive'
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
 * Compares TF2 vs TF3 for a given year and shows the added pixels.
 * Call manually, e.g.: testVisualize(2000);
 *
 * Layers generated:
 *   Green  = post-TF2 (input of this script)
 *   Red    = post-TF3 (output of this script)
 *   Cyan   = pixels ADDED by TF3 (the filled gaps)
 */
function testVisualize(year) {
  print('──────────────────────────────────────────');
  print('  TEST VISUAL — año ' + year);

  if (YEARS.indexOf(year) === -1) {
    print('  ⚠ Año ' + year + ' fuera del rango ' + YEAR_START + '–' + YEAR_END);
    return;
  }

  var yearType;
  if (year === FIRST_YEAR) {
    yearType = 'primer año — sin relleno posible';
  } else if (year === LAST_YEAR) {
    yearType = 'último año — continuidad desde ' + (year - 1);
  } else {
    yearType = 'intermedio — relleno si [' + (year-1) + ']=urb AND [' + (year+1) + ']=urb';
  }
  print('  Tipo: ' + yearType);

  // Filter 2 band (input)
  var tf2Band = tf2Image.select('classification_' + year);

  // Filter 3 band (computed on the fly)
  var tf3Band;
  if (year === FIRST_YEAR) {
    tf3Band = processFirst();
  } else if (year === LAST_YEAR) {
    tf3Band = processLast();
  } else {
    tf3Band = processMiddle(year);
  }

  // Pixels that TF3 adds relative to TF2
  var added = tf3Band.eq(URBAN_VALUE)
    .subtract(tf2Band.eq(URBAN_VALUE))
    .gt(0)
    .selfMask();

  Map.addLayer(
    tf2Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', '00FF00']},
    'TF2_' + year + ' (input)', false
  );
  Map.addLayer(
    tf3Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', 'FF0000']},
    'TF3_' + year + ' (output)', true
  );
  Map.addLayer(
    added,
    {min: 0, max: 1, palette: ['00FFFF']},
    'Added_by_TF3_' + year + ' (huecos rellenados)', true
  );

  Map.setCenter(-102, 23, 5);
  print('  Verde = post-TF2 | Rojo = post-TF3 | Cian = huecos rellenados por TF3');
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

// testVisualize(1985);   // first year (no filling)
// testVisualize(2000);   // intermediate year
// testVisualize(2010);   // intermediate year
// testVisualize(2025);   // last year (continuity)