/*
================================================================================
MAPBIOMAS MEXICO — URBAN SPATIAL FILTER
Centro Sur zone
Collection 1 · v0.01
================================================================================

Description:
  Applies morphological spatial filters to the harmonized urban classification
  probabilities per cell. For each year:
    1. Loads the harmonized per-cell probabilities
    2. Applies a cell- and period-specific threshold (from the thresholds asset)
    3. Runs morphological filters (closing, opening, noise removal)
    4. Builds a national mosaic per year

Adapted from: MapBiomas Argentina — 05 Spatial Filter
             (Luna Schteingart, Gonzalo Dieguez)
Zone: South-Center — cells 137 to 219

Critical conventions:
- Output folder is intentionally Classification/, not SpatialFilter/ (as
  used by the Centro Norte counterpart) — kept this way to distinguish
  this product's origin/lineage within the repository.
- Reclassification values: 0 = non-urban, 24 = urban, 27 = no-data/no-coverage
  (kept where the original classification had no valid pixel).
- Export has no explicit `region` — relies on the mosaicked cells' own
  footprint (see commented fallback near Export.image.toAsset if this
  causes issues).
================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var version        = 1;       // Version of input and output assets
var YEAR_START     = 1985;
var YEAR_END       = 2025;
var SKIP_EXISTING  = true;    // Skip already-exported years

// ============================================================================
// ASSET PATHS
// ============================================================================

var paths = {
  grid:        'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos',
  inputProba:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Harmonized_probabilities/',
  inputUmb:    'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Umbrales/',
  output:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Classification/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) {
  YEARS.push(y);
}

// ============================================================================
// CELL DISCOVERY HELPERS
// ============================================================================

/** Lists all assets in a folder, handling pagination (1000/call). */
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

/** Filters assets whose id ends exactly in _v<version>. */
function filterByVersion(assets, ver) {
  var suffix = '_v' + ver;
  return assets.filter(function(a) {
    return a.id.slice(-suffix.length) === suffix;
  });
}

/** Extracts celda_id from an asset id like '.../proba_harm_<id>_1985_2025_v1'. */
function extractCellIdFromHarm(assetId) {
  var match = assetId.match(/proba_harm_(\d+)_\d{4}_\d{4}_v/);
  return match ? parseInt(match[1], 10) : null;
}

/** Extracts the year from an asset id like '.../urban_spatial_filtered_<year>_v1_1985_2025'. */
function extractYearFromOutput(assetId) {
  var match = assetId.match(/urban_spatial_filtered_(\d{4})_v/);
  return match ? parseInt(match[1], 10) : null;
}

// ============================================================================
// DISCOVERY: AVAILABLE CELLS AND ALREADY-EXPORTED YEARS
// ============================================================================

print('═══════════════════════════════════════════════════════');
print('  FILTRO ESPACIAL URBANO — BATCH');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Output: ' + paths.output);
print('═══════════════════════════════════════════════════════');

// Cells with harmonized probabilities available
var harmAssets  = filterByVersion(listAllAssets(paths.inputProba), version);
var allCellIds  = harmAssets
  .map(function(a) { return extractCellIdFromHarm(a.id); })
  .filter(function(id) { return id !== null; });

allCellIds.sort(function(a, b) { return a - b; });
print('Celdas con probabilidades armonizadas:', allCellIds.length, allCellIds);

// Already-exported years (to skip if SKIP_EXISTING = true)
var yearsToProcess = YEARS;
if (SKIP_EXISTING) {
  try {
    var existingAssets  = filterByVersion(listAllAssets(paths.output), version);
    var existingYears   = existingAssets
      .map(function(a) { return extractYearFromOutput(a.id); })
      .filter(function(y) { return y !== null; });
    print('Años ya exportados (se saltan):', existingYears.length, existingYears);
    yearsToProcess = YEARS.filter(function(y) {
      return existingYears.indexOf(y) === -1;
    });
  } catch(e) {
    print('Output folder vacío o no existe aún — se exportarán todos los años.');
  }
}

print('──────────────────────────────────────────');
print('Años a procesar (' + yearsToProcess.length + '):', yearsToProcess);

// ============================================================================
// LOADING PER-CELL THRESHOLDS
// ============================================================================

/**
 * Loads the thresholds asset for a cell and returns an array of objects
 * [{yearStart, yearEnd, threshold_pct}, ...] sorted by yearStart.
 * Called with getInfo() — safe because each asset is small (~10 rows).
 */
function loadThresholdsForCell(celdaId) {
  var assetId = paths.inputUmb + 'umbrales_' + celdaId +
                '_' + YEAR_START + '_' + YEAR_END + '_v' + version;
  var info = ee.FeatureCollection(assetId)
    .sort('year_start')
    .toList(100)
    .getInfo();

  if (!info || info.length === 0) {
    throw new Error('Asset de umbrales vacío o no encontrado: ' + assetId);
  }

  return info.map(function(feat) {
    return {
      yearStart:     feat.properties.year_start,
      yearEnd:       feat.properties.year_end,
      threshold_pct: feat.properties.threshold_pct
    };
  });
}

/**
 * Given the array of periods for a cell, returns the threshold_pct
 * corresponding to a specific year.
 */
function getThresholdForYear(periodos, year) {
  for (var i = 0; i < periodos.length; i++) {
    if (year >= periodos[i].yearStart && year <= periodos[i].yearEnd) {
      return periodos[i].threshold_pct;
    }
  }
  // If the year falls in no defined period, use 50 as a fallback
  print('  ⚠ Sin período para año ' + year + ' — usando umbral = 50');
  return 50;
}

// ============================================================================
// MORPHOLOGICAL SPATIAL FILTERS
// (logic identical to Argentina — directly reusable)
// ============================================================================

/**
 * Applies morphological filters to a binary urban/non-urban image.
 * Order: closing → internal hole removal → opening → noise removal.
 */
function applySpatialFilter(image) {
  var kernel = ee.Kernel.circle({radius: 1});

  // 1. CLOSING: connects nearby urban pixels by closing small gaps
  image = image.unmask(0)
    .focal_max({iterations: 1, kernel: kernel})
    .focal_min({iterations: 1, kernel: kernel});

  // 2. INTERNAL HOLE REMOVAL
  //    Removes small non-urban areas (< nPix pixels) surrounded by urban
  var nPix = 60;
  var pixcountInverted = image.remap([0, 1], [1, 0])
    .selfMask()
    .connectedPixelCount(nPix, true);
  image = image
    .where(pixcountInverted.lt(nPix), 1)
    .reproject({crs: 'EPSG:4326', scale: 30});

  // 3. OPENING: smooths edges and removes thin extensions
  image = image
    .focal_min({iterations: 1, kernel: kernel})
    .focal_max({iterations: 1, kernel: kernel});

  // 4. NOISE REMOVAL: removes very small isolated urban components
  var pixcount = image.selfMask().connectedPixelCount();
  image = image
    .where(pixcount.lte(5), 0)
    .reproject({crs: 'EPSG:4326', scale: 30});

  return image;
}

/**
 * Reclassifies the filtered image to final MapBiomas values:
 *   0  = non-urban
 *   24 = urban
 * Keeps no-data (27) where there is no original coverage.
 */
function reclassImage(imageOriginal, imageFiltered) {
  imageOriginal = imageOriginal.unmask(27);
  imageFiltered = imageFiltered.remap([0, 1], [0, 24]);

  var image = imageFiltered.where(
    imageOriginal.eq(27).and(imageFiltered.eq(0)),
    0
  );
  return image.selfMask();
}

// ============================================================================
// PER-YEAR PROCESSING
// ============================================================================

var gridMx = ee.FeatureCollection(paths.grid);

/**
 * For a given year, processes all available cells, applies the threshold and
 * spatial filters, and returns the national mosaic as an ee.Image.
 *
 * Threshold loading (getInfo) happens here, inside the year loop,
 * to avoid saturating client memory in long sessions.
 */
function processYear(year) {
  print('──────────────────────────────────────────');
  print('Procesando año: ' + year);

  var yearImages    = [];
  var okCount       = 0;
  var errorCount    = 0;

  allCellIds.forEach(function(celdaId) {
    try {
      // --- Load the cell thresholds ---
      var periodos  = loadThresholdsForCell(celdaId);
      var threshold = getThresholdForYear(periodos, year);

      // --- Load the harmonized probabilities image ---
      var harmAssetId = paths.inputProba + 'proba_harm_' + celdaId +
                        '_' + YEAR_START + '_' + YEAR_END + '_v' + version;
      var probaImg    = ee.Image(harmAssetId);
      var bandName    = 'probability_' + year;

      // --- Apply threshold → binary image ---
      var binaryImg = probaImg.select(bandName).gte(threshold);

      // --- Morphological spatial filters ---
      var filteredImg = applySpatialFilter(binaryImg);

      // --- Reclassification to final values ---
      var finalImg = reclassImage(binaryImg, filteredImg)
        .set({
          'celda_id':      celdaId,
          'year':          year,
          'threshold_pct': threshold,
          'version':       version
        });

      yearImages.push(finalImg);
      okCount++;

    } catch(e) {
      print('  ⚠ Error en celda ' + celdaId + ': ' + e);
      errorCount++;
    }
  });

  print('  ✓ Celdas procesadas: ' + okCount +
        (errorCount > 0 ? '  ✗ Errores: ' + errorCount : ''));

  // --- National mosaic: merges all cells for the year ---
  var mosaic = ee.ImageCollection(yearImages)
    .mosaic()
    .rename('classification')
    .toByte()
    .set({
      'year':             year,
      'version':          version,
      'year_start':       YEAR_START,
      'year_end':         YEAR_END,
      'n_cells':          okCount,
      'n_errors':         errorCount,
      'territory':        'MEXICO',
      'theme':            'Urban Area',
      'source':           'MAPBIOMAS MEXICO',
      'collection_id':    '1',
      'processing':       'spatial_filter_morphological',
      'system:time_start': ee.Date.fromYMD(year, 1, 1).millis()
    });

  return mosaic;
}

// ============================================================================
// PER-YEAR EXPORT
// ============================================================================

/**
 * Exports the national mosaic of a year as an asset.
 * Name: urban_spatial_filtered_<year>_v<version>_<YEAR_START>_<YEAR_END>
 */
function exportYear(year) {
  var mosaic     = processYear(year);
  var outputName = 'urban_spatial_filtered_' + year + '_v' + version + '_' + YEAR_START + '_' + YEAR_END;

  Export.image.toAsset({
    image:            mosaic,
    description:      outputName,
    assetId:          paths.output + outputName,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: {'.default': 'mode'}
    // region: omitted — GEE infers the extent from the mosaicked cells
    // If the export fails due to region, uncomment the following line:
    // region: ee.FeatureCollection(paths.grid).geometry().bounds(),
  });

  print('  → Export encolado: ' + outputName);
}

// ============================================================================
// OPTIONAL VISUALIZATION (a single year for diagnostics)
// ============================================================================

/**
 * Adds the classification of a year to the map for a quick visual check.
 * Call manually: testVisualize(2000);
 */
function testVisualize(year) {
  var mosaic = processYear(year);
  Map.addLayer(
    mosaic,
    {min: 0, max: 24, palette: ['000000', 'FF0000']},
    'Urban_' + year + '_v' + version,
    true
  );
  Map.centerObject(ee.FeatureCollection(paths.grid).geometry(), 5);
  print('Visualización lista para año: ' + year);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

if (yearsToProcess.length === 0) {
  print('──────────────────────────────────────────');
  print('  Nada que procesar.');
  print('  Si esperabas tareas: revisar SKIP_EXISTING o el folder de entrada.');
} else {
  yearsToProcess.forEach(function(year) {
    exportYear(year);
  });

  print('──────────────────────────────────────────');
  print('  ✓ Tareas encoladas: ' + yearsToProcess.length);
  print('  → Pestaña "Tasks" → Run para iniciar cada una');
}

print('═══════════════════════════════════════════════════════');

// ============================================================================
// TESTING — uncomment to test a single year without exporting
// ============================================================================

// testVisualize(2000);