
/*
================================================================================
MAPBIOMAS MEXICO - URBAN CLASSIFICATION BATCH (v9), NORTH-CENTRAL (CENTRO-NORTE) REGION
Collection 1 - Urban theme
================================================================================
Description:
Runs the full urban classification pipeline per cell, for all cells in the
"centro-norte" subzone (or a filtered subset via CELLS_FILTER). For each
cell, trains one Random Forest classifier per time period, applies a
bilateral (urban + non-urban) probability threshold, classifies every year
within that period, and exports probability, binary classification, and
threshold metadata as three separate assets per cell.

Workflow (per cell, executed serially by processNextCell):
  1. Determine a buffer around the cell (250 km, expanding to 500 km if the
     nearby PCA validation pool is too small) to gather enough stable urban/
     non-urban reference points for threshold calibration.
  2. Pool training samples from the cell + its listed neighbors ('vecinos'),
     split into a fixed stable-urban base and a randomly sorted stable
     non-urban pool.
  3. For each period in PERIODOS_DEF:
     a. Build a balanced training set (urban base + growth samples up to
        that period's maxPeriodo, non-urban sampled at RATIO:1).
     b. Train a Random Forest classifier on the period's trainingYear mosaic.
     c. Calculate a bilateral threshold (calcThresholdSS) from PCA-validated
        urban/non-urban points, combined via THRESHOLD_STRATEGY and bounded
        by THRESHOLD_FLOOR/THRESHOLD_MARGIN.
     d. Classify every year in [yearStart, yearEnd] using that classifier
        and threshold.
  4. Stack all yearly probability/classification bands and export as two
     multi-band images, plus a FeatureCollection with one threshold record
     per period.

Critical conventions:
- Buffer escalation: cells with too few nearby PCA points fall back from
  BUFFER_KM_1 (250 km) to BUFFER_KM_2 (500 km); cells still short on points
  after that are skipped entirely (see processNextCell).
- Bilateral threshold (calcThresholdSS) computes t_urb (low-tail percentile
  of urban probabilities) and t_nourb (high-tail percentile of non-urban
  probabilities), combines them per THRESHOLD_STRATEGY ('max' by default),
  then adds THRESHOLD_MARGIN and floors at THRESHOLD_FLOOR.
- calcThresholdSS and submitCellTasks are written to avoid client-side
  .evaluate() calls internally — thresholds are lazy ee.Number objects
  resolved only when GEE runs the export tasks, not when tasks are queued.
- maskCompuesta requires the reference band to be valid across ALL period
  refYear mosaics simultaneously, to avoid training on partially masked data.
- Bands (33 total) combine arid spectral indices and GLCM texture metrics
  over two window sizes (5x5, 11x11) on the NIR band — this "extended" band
  set is tagged as band_variant: 'C-extendida' in export metadata.
- SKIP_EXISTING checks for an existing probabilities asset per cell before
  reprocessing — safe to re-run the script after a partial batch failure.
- PREVIEW_ONLY / PREVIEW_N let you sanity-check a couple of cells before
  launching the full batch; always confirm PREVIEW_ONLY = false only after
  reviewing preview output.

Output (per cell):
  - .../Probabilities/proba_{region}_{cell}_{yearStart}_{yearEnd}_C_v{version}
  - .../Classification/class_{region}_{cell}_{yearStart}_{yearEnd}_C_v{version}
  - .../Umbrales/umbrales_{region}_{cell}_{yearStart}_{yearEnd}_C_v{version}
================================================================================
*/

// ============================================================================
// BATCH PARAMETERS
// ============================================================================

var PREVIEW_ONLY  = false;   // true = only processes PREVIEW_N cells to verify
var PREVIEW_N     = 2;       // number of cells in preview mode
var SKIP_EXISTING = true;    // true = skips cells with an existing probabilities asset
var CELLS_FILTER  = Array.apply(null, {length: 136}).map(function(_, i) { return i + 1; }); // [103,100];
// ============================================================================
// CLASSIFICATION PARAMETERS
// ============================================================================

var version    = 1;
var nTrees     = 100;
var RATIO      = 2;

var SUBZONA    = 'centro-norte';
var regionName = 'centro_norte';

// Time blocks for training: each period trains one classifier on its
// trainingYear/refYear mosaic, then applies it to classify every year
// within [yearStart, yearEnd]. maxPeriodo caps which growth-sample
// periods (from Step 6 of the sampling script) are included in training.
var PERIODOS_DEF = [
  { yearStart: 1985, yearEnd: 1995, trainingYear: 1995, refYear: 1995, maxPeriodo: 3 },
  { yearStart: 1996, yearEnd: 2000, trainingYear: 2000, refYear: 2000, maxPeriodo: 4 },
  { yearStart: 2001, yearEnd: 2009, trainingYear: 2009, refYear: 2009, maxPeriodo: 6 },
  { yearStart: 2010, yearEnd: 2025, trainingYear: 2025, refYear: 2025, maxPeriodo: 9 }
];

var BUFFER_KM_1         = 250;
var BUFFER_KM_2         = 500;
var MIN_SAMPLES_PCA     = 50;
var MIN_SAMPLES_PCA_ABS = 50;

var PCT_DISCARD_URB    = 0.05;
var PCT_DISCARD_NOURB  = 0.05;
var THRESHOLD_FLOOR    = 65;
var THRESHOLD_MARGIN   = 10;
var THRESHOLD_STRATEGY = 'max';
var MAX_SAMPLES_THRESH = 460;

var LABEL_URB_PCA   = 'estable_urbano';
var LABEL_NOURB_PCA = 'estable_no_urbano';

var YEAR_START = 1985;
var YEAR_END   = 2025;

var MOSAIC_DIR     = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/Urban/COLLECTION-1/MOSAICS/CENTRO-NORTE';
var MOSAIC_PREFIX  = 'mosaic_mexico_centro_norte_urban_';
var MOSAIC_VERSION = 1;

var Bands = [
  'NBAI','BRBA','VrNIRBI','BLFEI','NDBI','PISI','UI','IBI','VIBI','VgNIRBI','EBBI',
  'IISI','MBAI','BAEM','DBSI','MBI','MNDBaI',
  'DULI1','DULI2','DULI3','DBI','NBLI',
  'NIR_asm_5','NIR_contrast_5','NIR_var_5','NIR_idm_5','NIR_ent_5',
  'NIR_asm_11','NIR_contrast_11','NIR_var_11','NIR_idm_11','NIR_ent_11'
];

var paths = {
  grid:             'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos',
  samples:          'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/urban_samples_expansion_v4_clean',
  pca:              'projects/mapbiomas-mexico/assets/pca_clean_v1',
  outputProba:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Probabilities/',
  outputClass:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Classification/',
  outputThresholds: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Umbrales/'
};

// ============================================================================
// END OF PARAMETERS
// ============================================================================

// ============================================================================
// GLOBAL SETUP (server-side, no evaluate)
// ============================================================================

// Composite mask: valid pixels across ALL reference mosaics
var maskCompuesta = PERIODOS_DEF.reduce(function(acc, p) {
  return acc.and(
    ee.Image(MOSAIC_DIR + '/' + MOSAIC_PREFIX + p.refYear + '_v' + MOSAIC_VERSION)
      .select([Bands[0]]).mask()
  );
}, ee.Image(1));

// Grid and PCA
var gridRegion = ee.FeatureCollection(paths.grid).filter(ee.Filter.eq('subzonas', SUBZONA));
var pcaAll     = ee.FeatureCollection(paths.pca);

// ============================================================================
// HELPER FUNCTIONS (server-side)
// ============================================================================

function getMosaic(year) {
  return ee.Image(MOSAIC_DIR + '/' + MOSAIC_PREFIX + year + '_v' + MOSAIC_VERSION)
    .select(Bands);
}

// ── calcThresholdSS ──────────────────────────────────────────────────────────
// Server-side version of calcThreshold: does not use evaluate().
// Returns t_final as an ee.Number. The actual computation happens when GEE runs
// the export, not when the task is queued.
// If the PCA points have no valid samples over land in that refYear,
// ee.Algorithms.If returns THRESHOLD_FLOOR as a safe fallback.
function calcThresholdSS(classifier, refYear, bufGeom, pcaUrb, pcaNOurb) {

  var proba = getMosaic(refYear)
    .classify(classifier).multiply(100).byte()
    .rename('probability').clip(bufGeom);

  var sampledUrb = proba.sampleRegions({
    collection:  pcaUrb,
    properties:  [],
    scale:       30,
    geometries:  false,
    tileScale:   4
  });

  var sampledNoUrb = proba.sampleRegions({
    collection:  pcaNOurb,
    properties:  [],
    scale:       30,
    geometries:  false,
    tileScale:   4
  });

  var nUrb   = sampledUrb.size();
  var nNoUrb = sampledNoUrb.size();

  // t_urb: PCT_DISCARD_URB percentile of urban samples (low tail)
  var t_urb = ee.Number(ee.Algorithms.If(
    nUrb.gte(MIN_SAMPLES_PCA_ABS),
    ee.Feature(
      sampledUrb.sort('probability', true)
        .toList(nUrb)
        .get(nUrb.multiply(PCT_DISCARD_URB).ceil())
    ).getNumber('probability'),
    ee.Number(THRESHOLD_FLOOR)
  ));

  // t_nourb: (1 - PCT_DISCARD_NOURB) percentile of non-urban samples (high tail)
  var t_nourb = ee.Number(ee.Algorithms.If(
    nNoUrb.gte(MIN_SAMPLES_PCA_ABS),
    ee.Feature(
      sampledNoUrb.sort('probability', true)
        .toList(nNoUrb)
        .get(nNoUrb.multiply(1 - PCT_DISCARD_NOURB).floor())
    ).getNumber('probability'),
    ee.Number(THRESHOLD_FLOOR)
  ));

  var t_combined;
  if (THRESHOLD_STRATEGY === 'max') {
    t_combined = t_urb.max(t_nourb);
  } else if (THRESHOLD_STRATEGY === 'mean') {
    t_combined = t_urb.add(t_nourb).divide(2);
  } else if (THRESHOLD_STRATEGY === 'urb_only') {
    t_combined = t_urb;
  } else {
    t_combined = t_nourb;
  }

  return t_combined.add(THRESHOLD_MARGIN).max(THRESHOLD_FLOOR);
}

// ── assetExists ──────────────────────────────────────────────────────────────
// Synchronous check of asset existence. Does not require evaluate().
function assetExists(assetId) {
  try { ee.data.getAsset(assetId); return true; }
  catch (e) { return false; }
}

// ============================================================================
// submitCellTasks
// Processes a whole cell synchronously (no internal evaluate).
// Builds the image stacks and the thresholds FeatureCollection,
// and queues the 3 exports as GEE Tasks.
// ============================================================================

function submitCellTasks(cid, geomCelda, bufGeom, bufKm, logPrefix) {

  // Neighbors and training samples (server-side)
  var celdaSel   = gridRegion.filter(ee.Filter.eq('id', cid)).first();
  var vecinosArr = ee.String(celdaSel.get('vecinos')).split(',').map(function(s) {
    return ee.Number.parse(ee.String(s).trim());
  });
  var allCellIds = ee.List([cid]).cat(vecinosArr);

  // PCA validated over land ONCE (server-side, no evaluate)
  var pcaUrbCand = pcaAll
    .filter(ee.Filter.eq('periodo_label', LABEL_URB_PCA))
    .filterBounds(bufGeom)
    .randomColumn('random', cid).sort('random').limit(MAX_SAMPLES_THRESH);

  var pcaNOurbCand = pcaAll
    .filter(ee.Filter.eq('periodo_label', LABEL_NOURB_PCA))
    .filterBounds(bufGeom)
    .randomColumn('random', cid).sort('random').limit(MAX_SAMPLES_THRESH);

  var bandRef = getMosaic(YEAR_END)
    .select([Bands[0]]).updateMask(maskCompuesta).clip(bufGeom);

  var pcaUrb = bandRef.sampleRegions({
    collection:  pcaUrbCand,
    properties:  [],
    scale:       30,
    geometries:  true,
    tileScale:   4
  });

  var pcaNOurb = bandRef.sampleRegions({
    collection:  pcaNOurbCand,
    properties:  [],
    scale:       30,
    geometries:  true,
    tileScale:   4
  });

  // Training sample pools
  var samplesAll = ee.FeatureCollection(paths.samples)
    .filter(ee.Filter.inList('cell_id', allCellIds))
    .filterBounds(bufGeom);

  var urbPool  = samplesAll.filter(ee.Filter.and(
    ee.Filter.eq('value', 1), ee.Filter.eq('paso', 'base_estable')
  ));
  var noUrbPool = samplesAll
    .filter(ee.Filter.eq('value', 0))
    .randomColumn('_sort', cid);

  // Trains one classifier per period and classifies all years in that
  // period's range. Runs synchronously (no evaluate/callbacks) so the whole
  // cell can be processed and its exports queued in a single pass.
  var probaStack     = [];
  var classStack     = [];
  var threshFeatures = [];

  PERIODOS_DEF.forEach(function(def) {

    // Balanced samples
    var growthFilters = [];
    for (var p = 2; p <= def.maxPeriodo; p++) {
      growthFilters.push(ee.Filter.eq('paso', 'incremento_periodo_' + p));
    }
    var urbTotal = (def.maxPeriodo === 0)
      ? urbPool
      : urbPool.merge(samplesAll.filter(
          growthFilters.length === 1
            ? growthFilters[0]
            : ee.Filter.or.apply(null, growthFilters)
        ));

    var samples = urbTotal.merge(
      noUrbPool.sort('_sort').limit(urbTotal.size().multiply(RATIO))
    );

    // Train RF
    var trainingData = getMosaic(def.trainingYear).clip(bufGeom)
      .sampleRegions({
        collection:  samples,
        properties:  ['value'],
        scale:       30,
        geometries:  false,
        tileScale:   16
      });

    var classifier = ee.Classifier.smileRandomForest({
      numberOfTrees:     nTrees,
      minLeafPopulation: 5
    })
    .train({
      features:        trainingData,
      classProperty:   'value',
      inputProperties: Bands
    })
    .setOutputMode('PROBABILITY');

    // Bilateral threshold (server-side, lazy ee.Number)
    var t_final = calcThresholdSS(classifier, def.refYear, bufGeom, pcaUrb, pcaNOurb);

    // Classify all years in the block
    for (var y = def.yearStart; y <= def.yearEnd; y++) {
      var prob = getMosaic(y)
        .classify(classifier).multiply(100).byte()
        .rename('probability').clip(geomCelda)
        .set({
          celda_id:      cid,
          year:          y,
          training_year: def.trainingYear,
          ref_year:      def.refYear,
          period_start:  def.yearStart,
          period_end:    def.yearEnd,
          version:       version,
          n_trees:       nTrees,
          ratio:         RATIO,
          threshold:     t_final.divide(100),
          threshold_pct: t_final,
          buffer_km:     bufKm,
          strategy:      THRESHOLD_STRATEGY
        });

      probaStack.push(prob.rename('probability_' + y));
      classStack.push(
        prob.select('probability').gte(t_final).rename('classification_' + y)
      );
    }

    // Threshold feature for this period
    threshFeatures.push(
      ee.Feature(geomCelda.centroid({ maxError: 1 }), {
        celda_id:       cid,
        subzona:        SUBZONA,
        region_name:    regionName,
        version:        version,
        year_start:     def.yearStart,
        year_end:       def.yearEnd,
        period_label:   def.yearStart + '-' + def.yearEnd,
        training_year:  def.trainingYear,
        ref_year:       def.refYear,
        max_periodo:    def.maxPeriodo,
        threshold_pct:  t_final,
        threshold:      t_final.divide(100),
        strategy:       THRESHOLD_STRATEGY,
        floor:          THRESHOLD_FLOOR,
        margin:         THRESHOLD_MARGIN,
        pct_discard_urb:   PCT_DISCARD_URB,
        pct_discard_nourb: PCT_DISCARD_NOURB,
        buffer_km:      bufKm,
        n_bands:        Bands.length
      })
    );
  });

  // ── Queue exports ──────────────────────────────────────────────────────
  var probaName  = 'proba_'    + regionName + '_' + cid + '_' + YEAR_START + '_' + YEAR_END + '_C_v' + version;
  var className  = 'class_'    + regionName + '_' + cid + '_' + YEAR_START + '_' + YEAR_END + '_C_v' + version;
  var umbralName = 'umbrales_' + regionName + '_' + cid + '_' + YEAR_START + '_' + YEAR_END + '_C_v' + version;

  var probaImage = ee.Image.cat(probaStack).set({
    celda_id:           cid,
    subzona:            SUBZONA,
    region_name:        regionName,
    version:            version,
    year_start:         YEAR_START,
    year_end:           YEAR_END,
    buffer_km:          bufKm,
    pct_discard_urb:    PCT_DISCARD_URB,
    pct_discard_nourb:  PCT_DISCARD_NOURB,
    threshold_floor:    THRESHOLD_FLOOR,
    threshold_margin:   THRESHOLD_MARGIN,
    threshold_strategy: THRESHOLD_STRATEGY,
    band_variant:       'C-extendida',
    n_bands:            Bands.length,
    mosaic_dir:         MOSAIC_DIR
  });

  var classImage = ee.Image.cat(classStack).set({
    celda_id:           cid,
    subzona:            SUBZONA,
    region_name:        regionName,
    version:            version,
    year_start:         YEAR_START,
    year_end:           YEAR_END,
    buffer_km:          bufKm,
    threshold_floor:    THRESHOLD_FLOOR,
    threshold_strategy: THRESHOLD_STRATEGY,
    band_variant:       'C-extendida',
    n_bands:            Bands.length
  });

  Export.image.toAsset({
    image:            probaImage,
    description:      probaName,
    assetId:          paths.outputProba + probaName,
    region:           geomCelda,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: { '.default': 'mean' }
  });

  Export.image.toAsset({
    image:            classImage,
    description:      className,
    assetId:          paths.outputClass + className,
    region:           geomCelda,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: { '.default': 'mode' }
  });

  Export.table.toAsset({
    collection:  ee.FeatureCollection(threshFeatures),
    description: umbralName,
    assetId:     paths.outputThresholds + umbralName
  });

  print(logPrefix + cid + ' → ' + bufKm + ' km · tareas encoladas: ' + probaName);
}

// ============================================================================
// processNextCell
// Processes the cells serially. One evaluate() per cell to decide the buffer.
// Chains to the next via callback to avoid saturating the call stack.
// ============================================================================

function processNextCell(cellIds, idx) {

  if (idx >= cellIds.length) {
    print('══════════════════════════════════════════════════════');
    print('BATCH COMPLETO');
    print('Celdas procesadas: ' + cellIds.length);
    print('Tareas encoladas:  ' + (cellIds.length * 3) + ' (proba + class + umbrales)');
    print('Verificar progreso en la pestaña Tasks de GEE.');
    print('══════════════════════════════════════════════════════');
    return;
  }

  var cid = cellIds[idx];
  var logPrefix = '[' + (idx + 1) + '/' + cellIds.length + '] celda ';

  // Check whether the probabilities asset already exists
  if (SKIP_EXISTING) {
    var probaCheck = 'proba_' + regionName + '_' + cid + '_' + YEAR_START + '_' + YEAR_END + '_C_v' + version;
    if (assetExists(paths.outputProba + probaCheck)) {
      print(logPrefix + cid + ' → ya existe, saltando');
      processNextCell(cellIds, idx + 1);
      return;
    }
  }

  var geomCelda = gridRegion.filter(ee.Filter.eq('id', cid)).geometry();
  var geomBuf1  = geomCelda.buffer(BUFFER_KM_1 * 1000);
  var geomBuf2  = geomCelda.buffer(BUFFER_KM_2 * 1000);

  // Base PCA pre-filtered to the maximum buffer
  var pcaUrbFull = pcaAll
    .filter(ee.Filter.eq('periodo_label', LABEL_URB_PCA))
    .filterBounds(geomBuf2);

  // Counts nearby PCA points in both candidate buffers in a single
  // server roundtrip, then picks the smallest buffer that meets
  // MIN_SAMPLES_PCA (falling back to the larger buffer, or skipping
  // the cell entirely if neither has enough points).
  ee.Dictionary({
    n1: pcaUrbFull.filterBounds(geomBuf1).size(),
    n2: pcaUrbFull.size()
  }).evaluate(function(counts, err) {

    if (err) {
      print(logPrefix + cid + ' → ERROR al evaluar PCA: ' + err);
      processNextCell(cellIds, idx + 1);
      return;
    }

    var n1 = counts.n1;
    var n2 = counts.n2;
    var bufGeom, bufKm;

    if (n1 >= MIN_SAMPLES_PCA) {
      bufGeom = geomBuf1; bufKm = BUFFER_KM_1;
    } else if (n2 >= MIN_SAMPLES_PCA_ABS) {
      bufGeom = geomBuf2; bufKm = BUFFER_KM_2;
      print(logPrefix + cid + ' → buf1 urb=' + n1 + ' < ' + MIN_SAMPLES_PCA + ', ampliando a ' + BUFFER_KM_2 + ' km (n2=' + n2 + ')');
    } else {
      print(logPrefix + cid + ' → PCA insuficiente (n1=' + n1 + ', n2=' + n2 + '), saltando');
      processNextCell(cellIds, idx + 1);
      return;
    }

    submitCellTasks(cid, geomCelda, bufGeom, bufKm, logPrefix);
    processNextCell(cellIds, idx + 1);
  });
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

var cellsFC = (CELLS_FILTER.length > 0)
  ? gridRegion.filter(ee.Filter.inList('id', CELLS_FILTER))
  : gridRegion;

cellsFC.aggregate_array('id').evaluate(function(allIds, err) {

  if (err) {
    print('⚠ Error obteniendo IDs de celdas:', err);
    return;
  }

  var cellIds = PREVIEW_ONLY ? allIds.slice(0, PREVIEW_N) : allIds;

  print('══════════════════════════════════════════════════════');
  print('BATCH CLASIFICACIÓN URBANA · v9 · CENTRO-NORTE');
  print('  Celdas en región:     ' + allIds.length);
  print('  Celdas a procesar:    ' + cellIds.length);
  print('  Modo:  ' + (PREVIEW_ONLY
    ? 'PREVIEW (' + PREVIEW_N + ' celdas) — cambiar PREVIEW_ONLY=false para producción'
    : 'PRODUCCIÓN — todas las celdas'));
  print('  Skip existing: ' + SKIP_EXISTING);
  print('  Buffer:  ' + BUFFER_KM_1 + ' km → ' + BUFFER_KM_2 + ' km (si urb_PCA < ' + MIN_SAMPLES_PCA + ')');
  print('  Umbral:  ' + THRESHOLD_STRATEGY + ' · floor=' + THRESHOLD_FLOOR + ' · margin=' + THRESHOLD_MARGIN);
  print('  Versión: ' + version);
  print('══════════════════════════════════════════════════════');

  if (PREVIEW_ONLY) {
    print('Primeras ' + PREVIEW_N + ' celdas a procesar: ' + cellIds.slice(0, PREVIEW_N));
  }

  processNextCell(cellIds, 0);
});

// Base visualization of the region
Map.centerObject(gridRegion, 5);
Map.addLayer(
  gridRegion.style({ color: '888888', fillColor: '00000011', width: 0.5 }),
  {}, 'Grid centro-norte', true
);