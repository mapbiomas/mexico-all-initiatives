/*
================================================================================
MAPBIOMAS MEXICO — TEMPORAL FILTER 4 (CUMULATIVE TEMPORAL CONSOLIDATION)
Collection 1 · v0.01
================================================================================

Description:
  Applies a fourth temporal filter based on cumulative consolidation.
  Implements the "once urban, always urban" philosophy to create strictly
  increasing or stable time series, removing inconsistent urban reversions.

  Philosophy: "Once urban, always urban" (cumulative temporal maximum)

Methodology:
  1. Loads the multiband image from temporal filter 3
  2. Validates the first year: if 1985=urban AND 1986=non-urban → correct to non-urban
  3. Applies the cumulative maximum: for each year Y, takes the MAX of all years
     from 1985 up to Y inclusive
  4. The result is a time series that can never decrease
  5. Exports as an asset

Key difference from TF1–TF3:
  TF1 and TF2 remove pixels
  TF3 fills isolated gaps (3-year window)
  TF4 consolidates toward the future permanently and irreversibly
      → expected effect: +5 to +15% of urban area

⚠ WARNING: This filter is very aggressive and may overestimate urban growth.
  A false positive in an early year propagates to all future years.
  Monitor the increment statistics before accepting results.

Adapted from: MapBiomas Argentina — 09 Temporal Filter 4
             (Luna Schteingart, Gonzalo Dieguez)

Critical conventions:
- getBand() uses server-side ee.Algorithms.If to check for missing bands,
  same pattern as TF2/TF3 — reliable handling without a client-side
  try/catch.
- SKIP_EXISTING defaults to true here; since this script produces a single
  national asset (not one per cell), toggle it off explicitly when a
  re-export is intended.
- URBAN_VALUE = 24 matches the reclassification convention carried over
  from earlier pipeline stages.
- validateFirstYear() exists specifically to prevent a base-year (1985)
  false positive from propagating through EVERY subsequent year via the
  cumulative maximum — this is the main safeguard against runaway
  overestimation from this filter.
- This is the most aggressive filter in the TF1–TF4 sequence: unlike
  TF1–TF3, its effect is irreversible and permanent (once a pixel is
  urban in year Y, it stays urban in all years > Y). Review the increment
  statistics carefully before accepting the output.

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
  input:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_3/',
  output: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Temporal_Filter_4/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) { YEARS.push(y); }

var URBAN_VALUE     = 24;
var MEXICO_GEOMETRY = ee.Geometry.Rectangle([-118.5, 14.5, -86.5, 32.8]);

// ============================================================================
// NAMING
// ============================================================================

function inputAssetName() {
  return 'urban_temporal_filter3_' + YEAR_START + '_' + YEAR_END + '_v' + version;
}

function outputAssetName() {
  return 'urban_temporal_filter4_' + YEAR_START + '_' + YEAR_END + '_v' + version;
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
print('  FILTRO TEMPORAL 4 — MAPBIOMAS MÉXICO');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Input:  ' + paths.input  + inputAssetName());
print('  Output: ' + paths.output + outputAssetName());
print('  Filosofía: una vez urbano, siempre urbano');
print('  ⚠ Filtro agresivo — puede sobreestimar crecimiento urbano');
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

var tf3Image = ee.Image(paths.input + inputAssetName());
print('──────────────────────────────────────────');
print('Imagen Filtro Temporal 3 cargada.');

/**
 * Returns the band of a year as a binary image (0/1).
 * Uses server-side ee.Algorithms.If to handle missing bands.
 */
function getBand(year) {
  var bandName = 'classification_' + year;
  var hasBand  = tf3Image.bandNames().contains(bandName);
  return ee.Image(ee.Algorithms.If(
    hasBand,
    tf3Image.select(bandName).eq(URBAN_VALUE).rename('urban'),
    ee.Image(0).rename('urban')
  ));
}

// ============================================================================
// TEMPORAL FILTER 4 — LOGIC
// ============================================================================

/**
 * Builds the source collection of TF3 binary images.
 * Each image carries the 'year' property so it can be filtered on it
 * in the cumulative maximum step.
 */
function buildSourceCollection() {
  var images = YEARS.map(function(year) {
    return getBand(year).set('year', year);
  });
  return ee.ImageCollection(images);
}

/**
 * First-year (1985) validation.
 *
 * Problem it solves: a false positive in the base year would propagate
 * to ALL future years via the cumulative maximum, systematically
 * inflating the entire series.
 *
 * Rule: if 1985=urban AND 1986=non-urban → correct 1985 to non-urban.
 * If 1985=urban AND 1986=urban → keep (it is real urban).
 */
function validateFirstYear() {
  var y1985 = getBand(YEAR_START);        // 1985
  var y1986 = getBand(YEAR_START + 1);    // 1986

  // Remove urban in 1985 if there is no continuity in 1986
  var validated = y1985.where(
    y1985.eq(1).and(y1986.eq(0)),
    0
  );

  return validated
    .multiply(URBAN_VALUE)
    .rename('classification_' + YEAR_START)
    .toInt8()
    .set({
      'year':        YEAR_START,
      'filter_type': 'first_year_validation',
      'rule':        'remove_if_urban_1985_and_nonurban_1986',
      'effect':      'eliminates_false_positives_at_base_year'
    });
}

/**
 * Applies the cumulative maximum for a given year.
 *
 * For year Y: filters the source collection to keep only the images
 * of years <= Y, then takes the pixel-wise maximum.
 *
 * Effect: if a pixel was urban in any previous year, its maximum
 * value (1) propagates to year Y even if that year was individually 0.
 *
 * Note: the first year (1985) is replaced by the validated version before
 * building the final collection, so false positives from the base year
 * do not propagate.
 */
function applyAccumulativeMax(sourceCollection, year) {
  var yearsUntilCurrent = sourceCollection
    .filter(ee.Filter.lte('year', year));

  return yearsUntilCurrent
    .max()
    .multiply(URBAN_VALUE)
    .rename('classification_' + year)
    .toInt8()
    .set({
      'year':        year,
      'filter_type': 'accumulative_max',
      'rule':        'max_of_all_years_up_to_' + year,
      'effect':      'once_urban_always_urban'
    });
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

function buildMultibandImage() {
  print('──────────────────────────────────────────');
  print('Paso 1: Validando primer año (' + YEAR_START + ')…');

  // 1. Validated first year (without base-year false positives)
  var firstYearValidated = validateFirstYear();

  print('Paso 2: Construyendo colección fuente con primer año corregido…');

  // 2. Rebuild the source collection replacing 1985 with its validated version
  //    This ensures the cumulative maximum does not propagate base-year false positives.
  var sourceImages = YEARS.map(function(year) {
    if (year === YEAR_START) {
      // Use the validated version of 1985 (binary, without the multiply(24) yet)
      var y1985 = getBand(YEAR_START);
      var y1986 = getBand(YEAR_START + 1);
      return y1985.where(y1985.eq(1).and(y1986.eq(0)), 0).set('year', year);
    }
    return getBand(year).set('year', year);
  });
  var sourceCollection = ee.ImageCollection(sourceImages);

  print('Paso 3: Aplicando máximo acumulativo a ' + YEARS.length + ' años…');

  // 3. Apply the cumulative maximum to all years
  //    The first year uses the validated image directly (it is already its own max).
  var bands = [];

  // First year: use the validated version directly
  bands.push(firstYearValidated);

  // Following years: cumulative maximum
  var subsequentYears = YEARS.slice(1); // 1986–2025
  subsequentYears.forEach(function(year) {
    bands.push(applyAccumulativeMax(sourceCollection, year));
  });

  print('Paso 4: Ensamblando imagen multibanda…');

  var multibandImage = ee.Image.cat(bands)
    .set({
      'collection_id':          '1',
      'version':                version,
      'territory':              'MEXICO',
      'theme':                  'Urban Area',
      'source':                 'MAPBIOMAS MEXICO',
      'filter_type':            'temporal_filter_4_consolidation',
      'filter_stage':           'temporal_accumulative_consolidation',
      'input_filter':           'temporal_filter_3',
      'first_year':             YEAR_START,
      'last_year':              YEAR_END,
      'total_years':            YEARS.length,
      'urban_value':            URBAN_VALUE,
      'effect':                 'INCREASES_urban_area_by_temporal_consolidation',
      'philosophy':             'once_urban_always_urban_max_accumulative',
      'warning':                'aggressive_filter_may_overestimate_urban_growth',
      'rules': JSON.stringify({
        'first_year': 'remove_if_urban_1985_and_nonurban_1986',
        'all_years':  'max_accumulative_from_1985_to_year_Y'
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
    overwrite:true,
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
 * Compares TF3 vs TF4 for a given year and shows the consolidated pixels.
 * Call manually, e.g.: testVisualize(2005);
 *
 * Layers generated:
 *   Red     = post-TF3 (input of this script)
 *   Blue    = post-TF4 (consolidated output)
 *   Yellow  = pixels ADDED by cumulative consolidation
 *
 * Interpretation: the yellow grows as the evaluated year advances —
 * in early years there will be little yellow; in later years much more,
 * reflecting the accumulation of urban history.
 */
function testVisualize(year) {
  print('──────────────────────────────────────────');
  print('  TEST VISUAL — año ' + year);

  if (YEARS.indexOf(year) === -1) {
    print('  ⚠ Año ' + year + ' fuera del rango ' + YEAR_START + '–' + YEAR_END);
    return;
  }

  // TF3 band (input)
  var tf3Band = tf3Image.select('classification_' + year);

  // Cumulative maximum up to this year (using the collection without validating the base,
  // since here we only visualize — validation is applied in buildMultibandImage)
  var sourceImages = YEARS.map(function(y) {
    return getBand(y).set('year', y);
  });
  var sourceCollection = ee.ImageCollection(sourceImages);

  var tf4Band;
  if (year === YEAR_START) {
    // First year: show the validated version
    tf4Band = validateFirstYear();
  } else {
    tf4Band = applyAccumulativeMax(sourceCollection, year);
  }

  // Pixels that TF4 adds relative to TF3
  var added = tf4Band.eq(URBAN_VALUE)
    .subtract(tf3Band.eq(URBAN_VALUE))
    .gt(0)
    .selfMask();

  Map.addLayer(
    tf3Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', 'FF0000']},
    'TF3_' + year + ' (input)', false
  );
  Map.addLayer(
    tf4Band,
    {min: 0, max: URBAN_VALUE, palette: ['000000', '0000FF']},
    'TF4_' + year + ' (consolidado)', true
  );
  Map.addLayer(
    added,
    {min: 0, max: 1, palette: ['FFFF00']},
    'Added_by_TF4_' + year + ' (consolidación)', true
  );

  Map.setCenter(-102, 23, 5);
  print('  Rojo = post-TF3 | Azul = post-TF4 | Amarillo = agregado por consolidación');
  print('  El amarillo aumenta con el año evaluado — normal en máximo acumulativo');
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

// testVisualize(1985);   // first year (with validation)
// testVisualize(1995);   // early intermediate year — little yellow expected
// testVisualize(2010);   // intermediate year — moderate yellow
// testVisualize(2025);   // last year — more yellow (all accumulated history)