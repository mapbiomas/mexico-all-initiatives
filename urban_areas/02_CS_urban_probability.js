/*
================================================================================
MAPBIOMAS MEXICO - URBAN CLASSIFICATION, SINGLE CELL (CENTRO-SUR)
Collection 1 - Urban theme · v0.01
================================================================================
Description:
Classifies urban probability and binary urban/non-urban extent for ONE grid
cell (celda_id) across the full 1985-2025 time series, using a Random Forest
classifier trained separately per period. 

Unlike the CENTRO-NORTE batch pipeline, which computes an automatic
bilateral threshold per period via PCA-validated reference points, this
script uses a MANUALLY DEFINED threshold per period (THRESHOLDS array).
Intended for single-cell testing/calibration before adopting or comparing
against the automatic threshold approach.

Workflow:
  1. Load the target cell + its listed neighbors ('vecinos') to pool
     training samples from a wider area than the cell alone.
  2. Build periods: a first period covering only YEAR_START (stable
     samples only), then consecutive PERIOD_STEP-year blocks (default 5)
     up to YEAR_END. Each period is trained on its own trainingYear mosaic
     and assigned one threshold from THRESHOLDS.
  3. Per period: assemble a balanced training set (urban stable + growth
     samples up to that period, non-urban at RATIO:1), train a Random
     Forest, and classify every year within the period.
  4. Stack yearly probability/classification bands; export as two
     multi-band images plus a FeatureCollection of per-period thresholds.
  5. Visualize mosaic / probability / thresholded binary layers for the
     years listed in year_viz, with a gradient legend on the map.

Critical conventions:
- THRESHOLDS[0] is shared by BOTH the first period (YEAR_START alone) and
  the first 5-year block (see period-construction loop) — 8 threshold
  values cover 9 periods total by design, not a mismatch.
- BUFFER_KM here (2 km) is a LOCAL buffer for filtering samples/mosaic
  around the cell — not to be confused with the much larger PCA-search
  buffers (250/500 km) used in the CENTRO-NORTE batch script.
- Bands (42 total): raw reflectance + spectral indices (vegetation, water,
  built-up/urban, soil, burn) + SMA fractions (two independent unmixing
  models) + temporal percentile statistics (EVI, EVI2, EBBI). See ATBD for
  full definitions.
- year_viz controls which years get map layers added (mosaic, probability,
  thresholded binary) — does not affect which years are classified/exported.

Output:
  - .../Probabilities/proba_{cell}_{yearStart}_{yearEnd}_v{version}
  - .../Classification/class_{cell}_{yearStart}_{yearEnd}_v{version}
  - .../Umbrales/umbrales_{cell}_{yearStart}_{yearEnd}_v{version}
================================================================================
*/

// ============================================================================
// PARAMETERS — EDIT HERE
// ============================================================================

var celda_id    = 168;      // ID of the cell to classify
var version     = 1;        // Output version
var nTrees      = 100;      // Number of RF trees
var RATIO       = 2;        // Non-urban : urban ratio
var BUFFER_KM   = 2;      // Buffer around the cell to filter samples

// Thresholds per 5-year period (0–1).
var THRESHOLDS = [
  0.7,  // [0] 1986–1990  (also applies to 1985)
  0.7,  // [1] 1991–1995
  0.7,  // [2] 1996–2000
  0.7,  // [3] 2001–2005
  0.7,  // [4] 2006–2010
  0.7,  // [5] 2011–2015
  0.7,  // [6] 2016–2020
  0.7   // [7] 2021–2025
];

// ============================================================================
// TEMPORAL CONFIGURATION
// ============================================================================

var YEAR_START  = 1985;
var YEAR_END    = 2025;
var PERIOD_STEP = 5;
var year_viz    = [1986, 1990, 1993 ,1995, 2000, 2010, 2020, 2025];

// ============================================================================
// PRE-EXPORTED MOSAICS
// ============================================================================

var MOSAIC_DIR     = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/Urban/COLLECTION-1/MOSAICS/CENTRO-SUR';
var MOSAIC_PREFIX  = 'mosaic_mexico_centro_sur_urban_';
var MOSAIC_VERSION = 1;

// ============================================================================
// END OF PARAMETERS — DO NOT EDIT BELOW THIS POINT
// ============================================================================

var N_PERIODOS_CREC = Math.ceil((YEAR_END - YEAR_START) / PERIOD_STEP);
if (THRESHOLDS.length < N_PERIODOS_CREC) {
  throw new Error('THRESHOLDS debe tener al menos ' + N_PERIODOS_CREC +
                  ' valores. Actual: ' + THRESHOLDS.length);
}

// Build periods with an assigned threshold.
// Period 0 covers YEAR_START alone (stable samples only); subsequent
// periods are PERIOD_STEP-year blocks, each with its own trainingYear
// and threshold.
var PERIODOS = [];

// Period 0: only stable pixels (1985), uses threshold [0]
PERIODOS.push({
  yearStart:    YEAR_START,
  yearEnd:      YEAR_START,
  trainingYear: YEAR_START,
  maxPeriodo:   0,
  threshold:    THRESHOLDS[0],
  label:        YEAR_START + ' (solo estables)'
});

// Five-year periods, each with its own threshold
var periodoNum = 2;
var thIdx      = 0;
for (var ys = YEAR_START + 1; ys <= YEAR_END; ys += PERIOD_STEP) {
  var ye = Math.min(ys + PERIOD_STEP - 1, YEAR_END);
  PERIODOS.push({
    yearStart:    ys,
    yearEnd:      ye,
    trainingYear: ye,
    maxPeriodo:   periodoNum,
    threshold:    THRESHOLDS[thIdx],
    label:        ys + '–' + ye
  });
  periodoNum++;
  thIdx++;
}

// --- Spectral bands ---
var Bands = [
  'BLUE', 'GREEN', 'RED', 'NIR', 'SWIR1', 'SWIR2',
  'NDVI', 'EVI', 'EVI2', 'SAVI',
  'MNDWI', 'NDWIm', 'AWEIsh',
  'NDBI', 'UI', 'NDUI', 'BSI', 'BU', 'EBBI',
  'NBR', 'NDRI', 'BAI',
  'NDFI', 'GV', 'NPV', 'SOIL', 'CLOUD', 'GVS', 'SHADE', 'SUBS',
  'VEG', 'DARK',
  'EVI_p10', 'EVI_p90', 'EVI2_p10', 'EVI2_p90',
  'EVI_dif9010', 'EVI2_dif9010',
  'EBBI_p25', 'EBBI_p75', 'EBBI_dif7525', 'EBBI_p90'
];

// --- Paths ---
var paths = {
  grid:             'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos',
  samples:          'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/urban_samples_expansion_v4_clean',
  outputProba:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Probabilities/',
  outputClass:      'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Classification/',
  outputThresholds: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Umbrales/'
};

// --- Load mosaic ---
function getMosaic(year) {
  var assetId = MOSAIC_DIR + '/' + MOSAIC_PREFIX + year + '_v' + MOSAIC_VERSION;
  return ee.Image(assetId).select(Bands);
}

// ============================================================================
// 1. GET CELL + NEIGHBORS
// ============================================================================

var gridMx   = ee.FeatureCollection(paths.grid);
var celdaSel = gridMx.filter(ee.Filter.eq('id', celda_id)).first();

var vecinosStr = ee.String(celdaSel.get('vecinos'));
var vecinosArr = vecinosStr.split(',').map(function(s) {
  return ee.Number.parse(ee.String(s).trim());
});
var allCellIds = ee.List([celda_id]).cat(vecinosArr);

var geomCelda       = gridMx.filter(ee.Filter.eq('id', celda_id)).geometry();
var geomTodas       = gridMx.filter(ee.Filter.inList('id', allCellIds)).geometry();
var geomCeldaBuffer = geomCelda.buffer(BUFFER_KM * 1000);

print('═══════════════════════════════════════════════════════');
print('  CLASIFICACIÓN URBANA — CELDA ' + celda_id);
print('  Vecinos:',        vecinosArr);
print('  Períodos:',        PERIODOS.length);
print('  Años: ' + YEAR_START + '–' + YEAR_END);
print('  Ratio: 1:' + RATIO);
print('  Visualización:',   year_viz);
print('═══════════════════════════════════════════════════════');

// Print the table of thresholds per period
print('──────────────────────────────────────────');
print('UMBRALES POR PERÍODO:');
PERIODOS.forEach(function(p) {
  print('  ' + p.label + '  →  umbral = ' + p.threshold +
        ' (' + (p.threshold * 100) + '%)');
});

// ============================================================================
// 2. LOAD SAMPLES AND DIAGNOSTICS
// ============================================================================

var samplesAll = ee.FeatureCollection(paths.samples)
  .filter(ee.Filter.inList('cell_id', allCellIds))
  .filterBounds(geomCeldaBuffer);

var samplesCelda = samplesAll.filter(ee.Filter.eq('cell_id', celda_id));

print('──────────────────────────────────────────');
print('MUESTRAS — CELDA ' + celda_id + ' (sin buffer)');
print('  Urbano estable:',
  samplesCelda.filter(ee.Filter.eq('tipo_muestra', 'urbano_estable')).size());
print('  Urbano crecimiento:',
  samplesCelda.filter(ee.Filter.eq('tipo_muestra', 'urbano_crecimiento')).size());
print('  No urbano estable:',
  samplesCelda.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_estable')).size());
print('  No urbano extra:',
  samplesCelda.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_extra')).size());
print('  Total:', samplesCelda.size());

print('──────────────────────────────────────────');
print('MUESTRAS — CELDA ' + celda_id + ' + VECINOS');
print('  Urbano estable:',
  samplesAll.filter(ee.Filter.eq('tipo_muestra', 'urbano_estable')).size());
print('  Urbano crecimiento:',
  samplesAll.filter(ee.Filter.eq('tipo_muestra', 'urbano_crecimiento')).size());
print('  No urbano estable:',
  samplesAll.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_estable')).size());
print('  No urbano extra:',
  samplesAll.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_extra')).size());
print('  Total:', samplesAll.size());

// --- Pre-separate pools ---
var urbEstablePool = samplesAll.filter(ee.Filter.and(
  ee.Filter.eq('value', 1),
  ee.Filter.or(
    ee.Filter.eq('paso', 'base_estable'),
    ee.Filter.eq('paso', 'extra_no_urbano')
  )
));

var noUrbPool = samplesAll.filter(ee.Filter.eq('value', 0))
  .randomColumn('_sort');

// ============================================================================
// 3. BALANCED SAMPLES PER PERIOD (ratio 1:2)
// ============================================================================

// Urban samples accumulate across periods (stable + growth increments up
// to maxPeriodo); non-urban is re-sampled at RATIO:1 against that total,
// so the non-urban pool grows along with the urban one.
function getSamplesByPeriod(maxPeriodo) {
  var urbTotal;

  if (maxPeriodo === 0) {
    urbTotal = urbEstablePool;
  } else {
    var growthFilters = [];
    for (var p = 2; p <= maxPeriodo; p++) {
      growthFilters.push(ee.Filter.eq('paso', 'incremento_periodo_' + p));
    }
    var growthFilter = (growthFilters.length === 1)
      ? growthFilters[0]
      : ee.Filter.or.apply(null, growthFilters);
    urbTotal = urbEstablePool.merge(samplesAll.filter(growthFilter));
  }

  var nUrbTotal     = urbTotal.size();
  var nNoUrbNeeded  = nUrbTotal.multiply(RATIO);
  var noUrbBalanced = noUrbPool.sort('_sort').limit(nNoUrbNeeded);

  return urbTotal.merge(noUrbBalanced);
}

// ============================================================================
// 4. TRAIN RF
// ============================================================================

function trainModel(samples, trainingYear) {
  var mosaicTrain = getMosaic(trainingYear).clip(geomCeldaBuffer);

  var trainingData = mosaicTrain.sampleRegions({
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

  return classifier;
}

// ============================================================================
// 5. CLASSIFY
// ============================================================================

function classifyYear(classifier, year, periodo) {
  var mosaicYear = getMosaic(year);

  var probability = mosaicYear.classify(classifier)
    .multiply(100)
    .byte()
    .rename('classification')
    .clip(geomCelda)
    .set({
      'celda_id':      celda_id,
      'year':          year,
      'training_year': periodo.trainingYear,
      'max_periodo':   periodo.maxPeriodo,
      'periodo_label': periodo.label,
      'version':       version,
      'n_trees':       nTrees,
      'n_bands':       Bands.length,
      'ratio':         RATIO,
      'threshold':     periodo.threshold
    });

  return probability;
}

// ============================================================================
// 6. MAIN EXECUTION
// ============================================================================

function runClassification() {

  var probaStack = [];
  var classStack = [];

  // Trains one classifier per period, then classifies every year in that
  // period with the same classifier and the period's fixed threshold.
  PERIODOS.forEach(function(periodo) {

    var yearsInPeriod = [];
    for (var y = periodo.yearStart; y <= periodo.yearEnd; y++) {
      yearsInPeriod.push(y);
    }

    var thPct = periodo.threshold * 100;

    print('──────────────────────────────────────────');
    print('PERÍODO: ' + periodo.label);
    print('  Entrenamiento: mosaico ' + periodo.trainingYear);
    print('  Años: ' + yearsInPeriod.join(', '));
    print('  Umbral: ' + periodo.threshold + ' (≥' + thPct + '%)');
    print('  Muestras: ratio 1:' + RATIO + ' (balanceo dinámico)');

    var samples    = getSamplesByPeriod(periodo.maxPeriodo);
    var classifier = trainModel(samples, periodo.trainingYear);
    print('  ✓ Modelo entrenado con mosaico ' + periodo.trainingYear);

    yearsInPeriod.forEach(function(year) {

      var probability = classifyYear(classifier, year, periodo);

      // Accumulate into stacks
      probaStack.push(probability.rename('probability_' + year));

      var urbanBand = probability.select('classification')
        .gte(thPct)
        .rename('classification_' + year);
      classStack.push(urbanBand);

      // Visualize only the selected years
      if (year_viz.indexOf(year) !== -1) {

        // Year mosaic — Natural Color (RED-GREEN-BLUE)
        Map.addLayer(
          getMosaic(year).clip(geomCelda),
          {bands: ['RED', 'GREEN', 'BLUE'], min: 1004.18, max: 1204.82, gamma: 1.3},
          'Mosaico ' + year + ' (RED-GREEN-BLUE)',
          false
        );

        // Probability
        Map.addLayer(
          probability,
          {min: 0, max: 100, palette: ['68ff0a', 'fbff08', 'ff3406']},
          'Prob. ' + year + ' (mod. ' + periodo.trainingYear + ')'
        );

        // Thresholded binary (uses the period threshold)
        Map.addLayer(
          urbanBand.selfMask(),
          {palette: ['FF0000']},
          'Urbano ' + year + ' (≥' + thPct + '%)',
          false
        );
      }

    });

    print('  ✓ ' + yearsInPeriod.length + ' años clasificados');
  });

  // ─── PROBABILITY IMAGE ───
  var probaImage = ee.Image.cat(probaStack).set({
    'celda_id':   celda_id,
    'version':    version,
    'n_trees':    nTrees,
    'ratio':      RATIO,
    'year_start': YEAR_START,
    'year_end':   YEAR_END,
    'thresholds': THRESHOLDS
  });

  // ─── BINARY CLASSIFICATION IMAGE ───
  var classImage = ee.Image.cat(classStack).set({
    'celda_id':   celda_id,
    'version':    version,
    'thresholds': THRESHOLDS,
    'year_start': YEAR_START,
    'year_end':   YEAR_END
  });

  // ─── THRESHOLDS FEATURE COLLECTION ───
  var centroideCelda = geomCelda.centroid({maxError: 1});

  var thresholdFeatures = PERIODOS.map(function(periodo) {
    return ee.Feature(centroideCelda, {
      celda_id:       celda_id,
      version:        version,
      periodo_label:  periodo.label,
      year_start:     periodo.yearStart,
      year_end:       periodo.yearEnd,
      training_year:  periodo.trainingYear,
      max_periodo:    periodo.maxPeriodo,
      threshold:      periodo.threshold,
      threshold_pct:  periodo.threshold * 100
    });
  });
var thresholdFC = ee.FeatureCollection(thresholdFeatures);

  // ─── EXPORTS ───
  Export.image.toAsset({
    image:            probaImage,
    description:      'proba_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version,
    assetId:          paths.outputProba + 'proba_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version,
    region:           geomCelda,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: {'.default': 'mean'}
  });

  Export.image.toAsset({
    image:            classImage,
    description:      'class_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version,
    assetId:          paths.outputClass + 'class_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version,
    region:           geomCelda,
    scale:            30,
    maxPixels:        1e13,
    pyramidingPolicy: {'.default': 'mode'}
  });

  Export.table.toAsset({
    collection:  thresholdFC,
    description: 'umbrales_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version,
    assetId:     paths.outputThresholds + 'umbrales_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version
  });

  print('──────────────────────────────────────────');
  print('  Exportaciones programadas:');
  print('    → Probabilidades (41 bandas): proba_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version);
  print('    → Clasificación  (41 bandas): class_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version);
  print('    → Umbrales (tabla):           umbrales_' + celda_id + '_' + YEAR_START + '_' + YEAR_END + '_v' + version);
}

// ============================================================================
// 7. BASE VISUALIZATION
// ============================================================================

Map.centerObject(geomCelda, 10);

Map.addLayer(
  gridMx.filter(ee.Filter.inList('id', vecinosArr))
    .style({color: '888888', fillColor: '00000011', width: 1}),
  {}, 'Celdas vecinas (entrenamiento)'
);

Map.addLayer(
  gridMx.filter(ee.Filter.eq('id', celda_id))
    .style({color: 'FFFFFF', fillColor: '00000000', width: 2.5}),
  {}, 'Celda ' + celda_id
);

// ============================================================================
// 8. LEGEND
// ============================================================================

var legend = ui.Panel({
  style: {
    position:        'bottom-left',
    padding:         '8px 12px',
    backgroundColor: 'white'
  }
});

legend.add(ui.Label({
  value: 'Probabilidad urbana — Celda ' + celda_id,
  style: {fontWeight: 'bold', fontSize: '13px', margin: '0 0 6px 0'}
}));

// Gradient bar
var gradient = ui.Thumbnail({
  image: ee.Image.pixelLonLat().select('longitude')
    .multiply(100 / 2)
    .visualize({
      min: 0, max: 100,
      palette: ['68ff0a', 'fbff08', 'ff3406']
    }),
  params: {bbox: [0, 0, 2, 0.15], dimensions: '200x15'},
  style:  {stretch: 'horizontal', margin: '0 0 4px 0'}
});
legend.add(gradient);

// min/max labels
var labelPanel = ui.Panel({
  widgets: [
    ui.Label({value: '0%',   style: {fontSize: '11px', margin: '0'}}),
    ui.Label({value: '100%', style: {fontSize: '11px', margin: '0'}})
  ],
  layout: ui.Panel.Layout.Flow('horizontal'),
  style:  {stretch: 'horizontal', textAlign: 'center'}
});
legend.add(labelPanel);

// Note about variable thresholds
legend.add(ui.Label({
  value: 'Umbrales: variables por período (ver consola)',
  style: {fontSize: '10px', color: '666', margin: '4px 0 0 0', fontStyle: 'italic'}
}));

// Separator
legend.add(ui.Label({value: '', style: {margin: '4px 0 4px 0', border: '0.5px solid #ddd'}}));

// Legend entries
function legendEntry(color, label) {
  var box = ui.Label({style: {
    backgroundColor: '#' + color, padding: '8px',
    margin: '0 6px 4px 0', border: '1px solid #ccc'
  }});
  var text = ui.Label({value: label, style: {margin: '0 0 4px 0', fontSize: '12px'}});
  return ui.Panel({widgets: [box, text], layout: ui.Panel.Layout.Flow('horizontal')});
}

legend.add(legendEntry('FF0000', 'Urbano (umbral variable)'));
legend.add(legendEntry('888888', 'Celdas vecinas'));
legend.add(legendEntry('FFFFFF', 'Celda ' + celda_id));

Map.add(legend);

// ============================================================================
// 9. RUN
// ============================================================================

runClassification();

print('═══════════════════════════════════════════════════════');
print('  CLASIFICACIÓN COMPLETA');
print('  Umbrales: variables por período (ver tabla arriba)');
print('  Visualización: ' + year_viz.join(', '));
print('  Export: 2 imágenes (41 bandas) + 1 tabla de umbrales');
print('═══════════════════════════════════════════════════════');