/*
================================================================================
MAPBIOMAS MEXICO - TEMPORAL HARMONIZATION BATCH (WHOLE COUNTRY)
Collection 1 - Urban theme · v0.01
================================================================================
Description:
Applies a temporal moving-average harmonization (±TEMPORAL_WINDOW years) to
the per-year probability bands of every cell with an existing probabilities
asset, smoothing year-to-year noise in the classifier's yearly output.
Automatically discovers which cells need processing by comparing input
(Probabilities/) vs. already-harmonized output (Harmonized_probabilities/)
assets, so the script can be safely re-run after a partial batch (SKIP_EXISTING).

Workflow:
  1. List all probability assets for the given version, extract their cell
     IDs (via filename pattern proba_<id>_<yearStart>_<yearEnd>_v<version>).
  2. If SKIP_EXISTING, list already-harmonized assets and remove their cell
     IDs from the processing list.
  3. Per cell: unpack the multiband probability image into a per-year
     ImageCollection, apply a temporal join (±TEMPORAL_WINDOW) to average
     each year with its neighboring years, and recompose the result into a
     single multiband image.
  4. Export the harmonized probability image per cell.

Critical conventions:
- This batch exports ONLY the harmonized probability image (proba_harm_*).
- Edge years (near YEAR_START/YEAR_END) average over fewer neighbors than
  interior years, since the ±TEMPORAL_WINDOW join has fewer matches near
  the boundaries.
- Asset discovery relies on exact filename patterns (regex in
  extractCellIdFromProba / extractCellIdFromHarm); renaming the export
  naming convention elsewhere in the pipeline would break this matching.
- MAX_CELLS_PER_RUN is a defensive cap for testing on a subset before a
  full run; 0 means no limit.

Output:
  - .../Harmonized_probabilities/proba_harm_{cell}_{yearStart}_{yearEnd}_v{version}
================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var version           = 1;     // Version of input and output assets
var TEMPORAL_WINDOW   = 2;     // ±N-year window for the moving average
var SKIP_EXISTING     = true;  // Skip already-harmonized cells (idempotence)
var MAX_CELLS_PER_RUN = 0;     // Defensive cap (0 = no limit)

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEAR_START = 1985;
var YEAR_END   = 2025;

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) {
  YEARS.push(y);
}

// ============================================================================
// PATHS
// ============================================================================

var paths = {
  grid:        'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos',
  inputProba:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Probabilities/',
  outputProba: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Harmonized_probabilities/'
};

// ============================================================================
// DISCOVERY HELPERS
// ============================================================================

/** Lists all assets in a folder, handling pagination (1000/call). */
function listAllAssets(folder) {
  var allAssets = [];
  var pageToken = null;
  var iterations = 0;
  var MAX_ITER = 10;
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

/** Filters assets whose id ends exactly in _v<version>. */
function filterByVersion(assets, versionStr) {
  var suffix = '_v' + versionStr;
  return assets.filter(function(a) {
    return a.id.slice(-suffix.length) === suffix;
  });
}

/** Extracts celda_id from an asset id like '.../proba_<id>_1985_2025_v1'. */
function extractCellIdFromProba(assetId) {
  var match = assetId.match(/proba_(\d+)_\d{4}_\d{4}_v/);
  return match ? parseInt(match[1], 10) : null;
}

/** Extracts celda_id from an asset id like '.../proba_harm_<id>_1985_2025_v1'. */
function extractCellIdFromHarm(assetId) {
  var match = assetId.match(/proba_harm_(\d+)_\d{4}_\d{4}_v/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// DISCOVER CELLS TO PROCESS
// ============================================================================

print('═══════════════════════════════════════════════════════');
print('  ARMONIZACIÓN TEMPORAL — BATCH');
print('  Ventana: ±' + TEMPORAL_WINDOW + ' años');
print('  Versión: v' + version);
print('  Output: ' + paths.outputProba);
print('═══════════════════════════════════════════════════════');

// Input: cells with exported probabilities
var probaAssets = filterByVersion(listAllAssets(paths.inputProba), version);
var allCellIds  = probaAssets
  .map(function(a) { return extractCellIdFromProba(a.id); })
  .filter(function(id) { return id !== null; });

print('Probabilidades de entrada disponibles:', allCellIds.length);

// Output: already-harmonized cells (to skip)
var existingCellIds = [];
if (SKIP_EXISTING) {
  try {
    var existingAssets = filterByVersion(listAllAssets(paths.outputProba), version);
    existingCellIds = existingAssets
      .map(function(a) { return extractCellIdFromHarm(a.id); })
      .filter(function(id) { return id !== null; });
    print('Ya armonizadas (se saltan):', existingCellIds.length);
  } catch (e) {
    print('Output folder vacío o no existe aún — se crearán todas.');
  }
}

// Final list to process
var cellsToProcess = allCellIds.filter(function(id) {
  return existingCellIds.indexOf(id) === -1;
});

if (MAX_CELLS_PER_RUN > 0 && cellsToProcess.length > MAX_CELLS_PER_RUN) {
  print('⚠ Limitando a primeras ' + MAX_CELLS_PER_RUN + ' de ' +
        cellsToProcess.length + ' celdas (MAX_CELLS_PER_RUN)');
  cellsToProcess = cellsToProcess.slice(0, MAX_CELLS_PER_RUN);
}

print('──────────────────────────────────────────');
print('Celdas a procesar (' + cellsToProcess.length + '):', cellsToProcess);

// ============================================================================
// HARMONIZATION FUNCTIONS
// ============================================================================

var gridMx = ee.FeatureCollection(paths.grid);

/** Converts a multiband image <prefix>YYYY to an ImageCollection (1 image/year). */
function multibandToCollection(img, prefix, celdaId) {
  var images = YEARS.map(function(year) {
    return img.select(prefix + year)
      .rename('probability')
      .set('year', year)
      .set('celda_id', celdaId);
  });
  return ee.ImageCollection.fromImages(images);
}

/** Moving average ±TEMPORAL_WINDOW years via a temporal join. */
function temporalHarmonization(probCol, celdaId) {
  var join = ee.Join.saveAll({matchesKey: 'images'});
  var filter = ee.Filter.maxDifference({
    difference: TEMPORAL_WINDOW,
    leftField:  'year',
    rightField: 'year'
  });
  var joined = join.apply(probCol, probCol, filter);

  return ee.ImageCollection(joined.map(function(image) {
    var year      = image.get('year');
    var neighbors = ee.ImageCollection.fromImages(ee.List(image.get('images')));
    var meanProb  = neighbors.reduce(ee.Reducer.mean()).rename('probability');

    return meanProb.set({
      'year':            year,
      'celda_id':        celdaId,
      'processing':      'temporally_harmonized',
      'temporal_window': TEMPORAL_WINDOW,
      'n_images_used':   neighbors.size()
    });
  }));
}

/** Recomposes an ImageCollection into a multiband image with bands <prefix>YYYY. */
function collectionToMultiband(col, bandPrefix) {
  var bandNames = YEARS.map(function(year) { return bandPrefix + year; });
  var stack = ee.ImageCollection(YEARS.map(function(year) {
    return col.filter(ee.Filter.eq('year', year)).first().rename(bandPrefix + year);
  })).toBands().rename(bandNames);
  return stack;
}

// ============================================================================
// PER-CELL PROCESSING
// ============================================================================

function processCell(celdaId) {
  var probaAssetId = paths.inputProba + 'proba_' + celdaId +
                     '_' + YEAR_START + '_' + YEAR_END + '_v' + version;

  var probaOriginal      = ee.Image(probaAssetId);
  var probaColOriginal   = multibandToCollection(probaOriginal, 'probability_', celdaId);
  var probaColHarmonized = temporalHarmonization(probaColOriginal, celdaId);

  var probaHarmImage = collectionToMultiband(probaColHarmonized, 'probability_')
    .toByte()
    .set({
      'celda_id':        celdaId,
      'version':         version,
      'temporal_window': TEMPORAL_WINDOW,
      'processing':      'temporal_harmonization',
      'year_start':      YEAR_START,
      'year_end':        YEAR_END,
      'source_asset':    probaAssetId
    });

  var geomCelda = gridMx.filter(ee.Filter.eq('id', celdaId)).geometry();
  var baseName  = celdaId + '_' + YEAR_START + '_' + YEAR_END + '_v' + version;

  Export.image.toAsset({
    image:            probaHarmImage,
    description:      'proba_harm_' + baseName,
    assetId:          paths.outputProba + 'proba_harm_' + baseName,
    region:           geomCelda,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: {'.default': 'mean'}
  });
}

// ============================================================================
// EXECUTION
// ============================================================================

if (cellsToProcess.length === 0) {
  print('──────────────────────────────────────────');
  print('  Nada que procesar.');
  print('  Si esperabas tareas: revisar SKIP_EXISTING o el folder de entrada.');
} else {
  cellsToProcess.forEach(function(celdaId, idx) {
    print('  [' + (idx + 1) + '/' + cellsToProcess.length + '] → celda ' + celdaId);
    processCell(celdaId);
  });

  print('──────────────────────────────────────────');
  print('  ✓ Tareas encoladas: ' + cellsToProcess.length);
  print('  → Pestaña "Tasks" → Run para iniciar cada una');
  print('  (o usa el botón "Run all" si aparece)');
}

print('═══════════════════════════════════════════════════════');
