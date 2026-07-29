/*
================================================================================
MAPBIOMAS MEXICO — URBAN SPATIAL FILTER
Centro Norte zone
Collection 1 · v0.01
================================================================================

Description:
  Applies morphological spatial filters to the binary urban/non-urban
  classifications (already thresholded) per cell. For each year:
    1. Loads the binary per-cell classification (band classification_<year>)
    2. Runs morphological filters (closing, opening, noise removal)
    3. Reclassifies to final MapBiomas values (0/24/27)
    4. Builds a national mosaic per year

Adapted from: MapBiomas Argentina — 05 Spatial Filter
             (Luna Schteingart, Gonzalo Dieguez)

Zone: North-Center — cells 1 to 136

Critical conventions:
- Reclassification values: 0 = non-urban, 24 = urban, 27 = no-data/no-coverage
  (kept where the original classification had no valid pixel).
- Export has no explicit `region` — relies on the mosaic's own footprint,
  which comes from the upstream per-cell classification already being
  clipped to each cell's geometry.
- The per-cell try/catch in processYear does NOT reliably catch missing-
  asset errors, since ee.Image() and .select() are lazy — errors from a
  missing cell asset will surface later, as an export task failure, not
  as a caught exception here.

================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var version        = 1;
var YEAR_START     = 1985;
var YEAR_END       = 2025;
var SKIP_EXISTING  = true;

// Range of centro norte cells
var CELL_START     = 1;
var CELL_END       = 136;

// ============================================================================
// ASSET PATHS
// ============================================================================

var paths = {
  grid:        'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos',
  inputClass:  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Classification/',
  output:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/SpatialFilter/'
};

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEARS = [];
for (var y = YEAR_START; y <= YEAR_END; y++) {
  YEARS.push(y);
}

// ============================================================================
// BUILD LIST OF CELLS (fixed range, no dynamic listing)
// ============================================================================

var allCellIds = [];
for (var c = CELL_START; c <= CELL_END; c++) {
  allCellIds.push(c);
}

print('═══════════════════════════════════════════════════════');
print('  FILTRO ESPACIAL URBANO — ZONA CENTRO NORTE');
print('  Celdas: ' + CELL_START + '–' + CELL_END + ' (' + allCellIds.length + ' celdas)');
print('  Período: ' + YEAR_START + '–' + YEAR_END);
print('  Versión: v' + version);
print('  Output: ' + paths.output);
print('═══════════════════════════════════════════════════════');

// ============================================================================
// ALREADY-EXPORTED YEARS (idempotence)
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

/** Extracts the year from an asset id like '.../urban_spatial_filtered_<year>_v1_1985_2025'. */
function extractYearFromOutput(assetId) {
  var match = assetId.match(/urban_spatial_filtered_(\d{4})_v/);
  return match ? parseInt(match[1], 10) : null;
}

var yearsToProcess = YEARS;
if (SKIP_EXISTING) {
  try {
    var existingAssets = filterByVersion(listAllAssets(paths.output), version);
    var existingYears  = existingAssets
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
// MORPHOLOGICAL SPATIAL FILTERS
// (logic identical to Argentina / centro sur — directly reusable)
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
 * Keeps no-data (27) where there is no coverage in the original classification.
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
 * Input naming: class_centro_norte_<celda_id>_1985_2025_C_v1
 * Band: classification_<year>
 */
function processYear(year) {
  print('──────────────────────────────────────────');
  print('Procesando año: ' + year);

  var yearImages = [];
  var okCount    = 0;
  var errorCount = 0;

  allCellIds.forEach(function(celdaId) {
    try {
      var classAssetId = paths.inputClass + 'class_centro_norte_' + celdaId +
                          '_' + YEAR_START + '_' + YEAR_END + '_C_v' + version;
      var classImg = ee.Image(classAssetId);
      var bandName = 'classification_' + year;

      var binaryImg   = classImg.select(bandName);
      var filteredImg = applySpatialFilter(binaryImg);
      var finalImg    = reclassImage(binaryImg, filteredImg)
        .set({
          'celda_id': celdaId,
          'year':     year,
          'version':  version
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

function exportYear(year) {
  var mosaic     = processYear(year);
  var outputName = 'urban_spatial_filtered_centro_norte_' + year + '_v' + version +
                   '_' + YEAR_START + '_' + YEAR_END;

  Export.image.toAsset({
    image:            mosaic,
    description:      outputName,
    assetId:          paths.output + outputName,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });

  print('  → Export encolado: ' + outputName);
}

// ============================================================================
// OPTIONAL VISUALIZATION
// ============================================================================

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
