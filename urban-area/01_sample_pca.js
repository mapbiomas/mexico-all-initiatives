
/*
================================================================================
MAPBIOMAS MEXICO - URBAN TRAINING SAMPLES (EXPANSION V4)
Collection 1 - Urban theme
================================================================================
Description:
Generates stratified training samples for the urban classifier, per grid
cell, based on GHS Built-up Surface (JRC/GHSL) reclassified into stable and
growth periods (1985-2025). Samples are refined via PCA-based outlier
filtering and combined into a balanced final set (300 urban : 600 non-urban,
1:2 ratio) per cell.

Workflow:
  1. Reclassify GHS built surface into 10 classes: stable urban, stable
     non-urban, and 8 growth periods (1985-1990 ... 2020-2025), using
     URBAN_THRESHOLD as the built-surface cutoff.
  2. Compute local growth proportions per period (needed to distribute
     growth samples proportionally in step 6).
  3. Draw random seed samples (1500/class) from the stable classes only.
  4. Extract PCA (PC_urban, from NDBI/UI/NDUI/EBBI) over the seed samples
     and filter outliers using ±2SD, independently per class.
  5. Take a base sample from the filtered points (230 urban / 460 non-urban).
  6. Add extras: growth-period urban points (+70), sampled directly from
     each period mask proportional to local growth %; and extra non-urban
     points (+140), drawn from PCA leftovers not used in the base sample.
  7. Export final samples (900/cell) as a GEE asset and CSV; PCA leftovers
     are also exported separately (useful for QA or reuse in other cells).

Critical conventions:
- `celda_id` controls single-cell mode, used for QA/visual review of one
  cell before running at scale.
- Stable classes are defined by comparing only the endpoints (1985 vs 2025),
  not by requiring all intermediate periods to be built/non-built.
- Sampling uses an oversample + random-sort + limit pattern (sampleFromMask
  / cellSample) to guarantee the target count even in small mask areas.
- PCA ±2SD filtering is computed independently for urban and non-urban
  classes (different mean/SD per class).
- Seeds are offset per class/step (SEED, SEED+1, SEED+20+i, ...) to keep
  sampling reproducible while avoiding correlated draws across periods.
- RUN_BATCH controls the all-grid export block at the end of the script.
  Keep it FALSE for single-cell QA runs (default). Set to TRUE only when
  ready to launch export tasks for every cell in the grid.

Output:
  - .../Samples/expansion_v4/celda_X       (final 900 samples/cell)
  - .../Samples/pca_sobrantes/celda_X      (PCA leftovers, both classes)
  - CSV copies → Google Drive, folder "MapBiomas_Mexico_Urban"
================================================================================
*/

var lib_pca = require('users/Bfast/mapbiomas:urbano/funciones/lib_pca_urban');

// ============================================================
// PARAMETERS — EDIT HERE
// ============================================================

var celda_id        = 168;    // ← ID of the cell to process
var URBAN_THRESHOLD = 200;    // m² built-up surface (GHS)

// Set to true only when ready to export the full grid (all cells).
// Keep false for single-cell QA runs.
var RUN_BATCH        = false;

// --- Sampling seed ---
var SEED_SAMPLES    = 1500;   // Random points per stable class
// Growth samples are generated in step 6
// according to the normalized proportions (no fixed pool is used).

// --- Final sample sizes ---
var BASE_URBAN      = 230;    // Stable urban post-PCA
var BASE_NON_URBAN  = 460;    // Stable non-urban post-PCA
var MAX_URBAN       = 300;
var EXTRA_URBAN     = MAX_URBAN - BASE_URBAN;  // 70
var EXTRA_NON_URBAN = EXTRA_URBAN * 2;         // 140
// Totals: 300 urb + 600 non-urb = 900/cell

var SEED            = 42;

// PCA bands
var PCA_BANDS = ['NDBI', 'UI', 'NDUI', 'EBBI'];

// ============================================================
// INPUT DATA
// ============================================================

var ghsBuilt = ee.ImageCollection('JRC/GHSL/P2023A/GHS_BUILT_S')
  .map(function(img) {
    var hasTotal = img.bandNames().contains('built_surface_total');
    var builtTotal = ee.Image(ee.Algorithms.If(
      hasTotal,
      img.select('built_surface_total'),
      img.select('built_surface')
    ));
    return builtTotal.rename('built_surface_total')
      .copyProperties(img, img.propertyNames());
  });

var mosaic1986 = ee.Image(
  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/MOSAICS/mosaic_mexico_urban_1986_v1'
);

var gridMx = ee.FeatureCollection(
  'projects/mapbiomas-mexico/assets/malla_geoestadistica_sel_id'
);

// ============================================================
// CELL SELECTION
// ============================================================

var celdaSel = gridMx.filter(ee.Filter.eq('id', celda_id));
var geom     = celdaSel.geometry();

print('═══════════════════════════════════════════');
print('  Celda seleccionada: ' + celda_id);
print('═══════════════════════════════════════════');


// ============================================================
// STEP 1: GHS RECLASSIFICATION
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 1: Reclassification of GHS by periods');
print('═══════════════════════════════════════════');

// Returns a binary mask (built vs not built) for a given GHS epoch,
// using URBAN_THRESHOLD as cutoff
function getUrbanMask(epoch) {
  return ghsBuilt
    .filter(ee.Filter.eq('system:index', String(epoch)))
    .first()
    .gte(URBAN_THRESHOLD)
    .rename('urban_' + epoch);
}

var urban1985 = getUrbanMask(1985);
var urban1990 = getUrbanMask(1990);
var urban1995 = getUrbanMask(1995);
var urban2000 = getUrbanMask(2000);
var urban2005 = getUrbanMask(2005);
var urban2010 = getUrbanMask(2010);
var urban2015 = getUrbanMask(2015);
var urban2020 = getUrbanMask(2020);
var urban2025 = getUrbanMask(2025);

// Stable classes compare only the endpoints (1985 vs 2025).
// Growth classes compare consecutive GHS epochs to pinpoint the period
// in which each pixel transitioned from non-built to built.
var stableUrban    = urban1985.and(urban2025);
var stableNonUrban = urban1985.not().and(urban2025.not());

var growth_1985_1990 = urban1985.not().and(urban1990);
var growth_1990_1995 = urban1990.not().and(urban1995);
var growth_1995_2000 = urban1995.not().and(urban2000);
var growth_2000_2005 = urban2000.not().and(urban2005);
var growth_2005_2010 = urban2005.not().and(urban2010);
var growth_2010_2015 = urban2010.not().and(urban2015);
var growth_2015_2020 = urban2015.not().and(urban2020);
var growth_2020_2025 = urban2020.not().and(urban2025);

var urbanPeriodClass = ee.Image(0)
  .where(growth_2020_2025, 9)
  .where(growth_2015_2020, 8)
  .where(growth_2010_2015, 7)
  .where(growth_2005_2010, 6)
  .where(growth_2000_2005, 5)
  .where(growth_1995_2000, 4)
  .where(growth_1990_1995, 3)
  .where(growth_1985_1990, 2)
  .where(stableNonUrban, 0)
  .where(stableUrban, 1)
  .rename('periodo_urbano')
  .toUint8();

var urbanPeriodCell = urbanPeriodClass.clip(geom);

var periodLabels = ee.Dictionary({
  0: 'estable_no_urbano', 1: 'estable_urbano',
  2: 'crecimiento_1985_1990', 3: 'crecimiento_1990_1995',
  4: 'crecimiento_1995_2000', 5: 'crecimiento_2000_2005',
  6: 'crecimiento_2005_2010', 7: 'crecimiento_2010_2015',
  8: 'crecimiento_2015_2020', 9: 'crecimiento_2020_2025'
});

print('Clasificación de periodos creada');


// ============================================================
// URBAN GROWTH MAP
// ============================================================

var periodPalette = [
  '#E0E0E0','#1A1A2E','#16213E','#0F3460','#533483',
  '#E94560','#FF6B35','#F7B731','#20BF6B','#45AAF2'
];

Map.centerObject(geom, 10);
Map.addLayer(mosaic1986.select(['SWIR1','NIR','RED']).clip(geom),
  {min:0, max:3000}, 'Mosaico 1986 (SWIR-NIR-RED)', false);
Map.addLayer(urbanPeriodCell.selfMask(),
  {min:1, max:9, palette: periodPalette.slice(1)},
  'Crecimiento urbano — celda ' + celda_id);

var periodNames = [
  'Estable no urbano','Estable urbano',
  'Crec 1985-1990','Crec 1990-1995','Crec 1995-2000','Crec 2000-2005',
  'Crec 2005-2010','Crec 2010-2015','Crec 2015-2020','Crec 2020-2025'
];
for (var p = 0; p <= 9; p++) {
  Map.addLayer(urbanPeriodCell.eq(p).selfMask(),
    {palette: [periodPalette[p]]}, periodNames[p], false);
}
Map.addLayer(celdaSel.style({color:'FFFFFF', fillColor:'00000000', width:2}),
  {}, 'Contorno celda ' + celda_id);


// ============================================================
// STEP 2: URBAN GROWTH PERCENTAGE (LOCAL)
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 2: Growth percentage in cell ' + celda_id);
print('═══════════════════════════════════════════');

var cellHistogram = urbanPeriodCell.reduceRegion({
  reducer: ee.Reducer.frequencyHistogram(),
  geometry: geom, scale: 100, maxPixels: 1e13, bestEffort: true
});
var histogram = ee.Dictionary(cellHistogram.get('periodo_urbano'));
print('Histograma:', histogram);

// Chart in km²
var periodDescriptions = ee.Dictionary({
  '0':'0-Estable no urbano','1':'1-Estable urbano',
  '2':'2-Crec 1985-1990','3':'3-Crec 1990-1995','4':'4-Crec 1995-2000',
  '5':'5-Crec 2000-2005','6':'6-Crec 2005-2010','7':'7-Crec 2010-2015',
  '8':'8-Crec 2015-2020','9':'9-Crec 2020-2025'
});
var allPeriodKeys = ee.List.sequence(0,9).map(function(k){return ee.Number(k).format('%d');});
var histKm2 = ee.FeatureCollection(allPeriodKeys.map(function(k){
  return ee.Feature(null, {periodo:k, periodo_desc:periodDescriptions.get(k,k),
    area_km2: ee.Number(histogram.get(k,0)).multiply(0.01)});
}));
print(ui.Chart.feature.byFeature(histKm2,'periodo_desc','area_km2')
  .setChartType('ColumnChart')
  .setOptions({title:'Área por periodo km² (celda '+celda_id+')',
    hAxis:{title:'Periodo'},vAxis:{title:'Área (km²)'},legend:{position:'none'}}));

function sumHistogramKeys(dict, keys) {
  return ee.Number(ee.List(keys).iterate(function(k, acc) {
    return ee.Number(acc).add(ee.Number(dict.get(ee.String(k), 0)));
  }, 0));
}

var urbanKeys = ['1','2','3','4','5','6','7','8','9'];
var urbanKeysEe = ee.List(urbanKeys);
var totalUrbanPixels = sumHistogramKeys(histogram, urbanKeysEe);
print('Píxeles urbanos totales en celda:', totalUrbanPixels);

var growthPercentages = ee.Dictionary.fromLists(urbanKeysEe,
  urbanKeysEe.map(function(k){return ee.Number(histogram.get(k,0)).divide(totalUrbanPixels);}));

var periodLabelDict = ee.Dictionary({
  '1':'Estable urbano','2':'1985-1990','3':'1990-1995','4':'1995-2000',
  '5':'2000-2005','6':'2005-2010','7':'2010-2015','8':'2015-2020','9':'2020-2025'
});
print('--- Distribución urbana en celda ' + celda_id + ' ---');
urbanKeys.forEach(function(k) {
  var pct = ee.Number(growthPercentages.get(k)).multiply(10000).round().divide(100);
  print(ee.String('  ').cat(k).cat(' (').cat(ee.String(periodLabelDict.get(k,'?'))).cat('): ').cat(ee.String(pct)).cat('%'));
});

var growthOnlyKeys = ee.List(['2','3','4','5','6','7','8','9']);
var totalGrowthPixels = sumHistogramKeys(histogram, growthOnlyKeys);
var growthNormalized = ee.Dictionary.fromLists(growthOnlyKeys,
  growthOnlyKeys.map(function(k){
    var raw = ee.Number(histogram.get(k,0));
    return ee.Algorithms.If(totalGrowthPixels.gt(0), raw.divide(totalGrowthPixels), ee.Number(0));
  }));
print('Proporciones normalizadas de crecimiento:', growthNormalized);


// ============================================================
// STEP 3: GENERATION OF STABLE SAMPLES (FROM SCRATCH)
// ============================================================


print('═══════════════════════════════════════════');
print('  STEP 3: Generation of new samples');
print('═══════════════════════════════════════════');

// Robust sampling function: oversample + sort random + limit
function sampleFromMask(mask, numTarget, overFactor, seedVal) {
  var withRandom = mask.selfMask().addBands(
    ee.Image.random(seedVal).rename('random')
  );
  return withRandom.sample({
    region: geom, scale: 100,
    numPixels: numTarget * overFactor,
    seed: seedVal, geometries: true
  }).sort('random').limit(numTarget);
}

// --- Stable samples (1500 per class) ---
var seedUrbanStable = sampleFromMask(urbanPeriodCell.eq(1), SEED_SAMPLES, 50, SEED)
  .map(function(f) {
    return f.set({periodo_urbano:1, periodo_label:'estable_urbano', value:1});
  });

var seedNonUrbanStable = sampleFromMask(urbanPeriodCell.eq(0), SEED_SAMPLES, 50, SEED + 1)
  .map(function(f) {
    return f.set({periodo_urbano:0, periodo_label:'estable_no_urbano', value:0});
  });

print('Semilla urbano estable:', seedUrbanStable.size());
print('Semilla no-urbano estable:', seedNonUrbanStable.size());

// Growth samples are generated directly in step 6,
// with the exact amount derived from the normalized growth %.
var growthOnlyKeysJs = ['2','3','4','5','6','7','8','9'];
var growthPeriodLabelsJs = {
  '2':'crecimiento_1985_1990','3':'crecimiento_1990_1995',
  '4':'crecimiento_1995_2000','5':'crecimiento_2000_2005',
  '6':'crecimiento_2005_2010','7':'crecimiento_2010_2015',
  '8':'crecimiento_2015_2020','9':'crecimiento_2020_2025'
};


// ============================================================
// STEP 4: PCA + ±2SD FILTERING (ONLY PCA_BANDS)
// ============================================================
// Only NDBI, UI, NDUI, EBBI + PC_urban (5 bands) are extracted.
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 4: PCA + filtering ±2SD');
print('═══════════════════════════════════════════');

var mosaicPCA = mosaic1986.select(PCA_BANDS).clip(geom);
var mosaicWithPC = lib_pca.addPC1Urban(mosaicPCA, geom);
print('Bandas PCA:', mosaicWithPC.bandNames());

// Extract PCA over the 1500 samples per class
var urbanWithPCA = mosaicWithPC.sampleRegions({
  collection: seedUrbanStable, scale: 30, geometries: true, tileScale: 16
});
var nonUrbanWithPCA = mosaicWithPC.sampleRegions({
  collection: seedNonUrbanStable, scale: 30, geometries: true, tileScale: 16
});

print('Urbanas con PCA:', urbanWithPCA.size());
print('No urbanas con PCA:', nonUrbanWithPCA.size());

// --- 4a. Urban filter ---
var urbanPcStats = urbanWithPCA.reduceColumns({
  reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true),
  selectors: ['PC_urban']
});
var urbanPcMean = ee.Number(urbanPcStats.get('mean'));
var urbanPcSD   = ee.Number(urbanPcStats.get('stdDev'));
var urbanLower  = urbanPcMean.subtract(urbanPcSD.multiply(2));
var urbanUpper  = urbanPcMean.add(urbanPcSD.multiply(2));

print('--- PC_urban URBANOS ---');
print('  Media:', urbanPcMean, '  SD:', urbanPcSD);
print('  Rango ±2SD: [', urbanLower, ',', urbanUpper, ']');

var urbanFiltered = urbanWithPCA.filter(ee.Filter.and(
  ee.Filter.gte('PC_urban', urbanLower),
  ee.Filter.lte('PC_urban', urbanUpper)
));

print('► Urbanas ANTES:', urbanWithPCA.size());
print('► Urbanas DESPUÉS (±2SD):', urbanFiltered.size());
print('► Eliminadas:', urbanWithPCA.size().subtract(urbanFiltered.size()));

// --- 4b. Non-urban filter ---
var nonUrbanPcStats = nonUrbanWithPCA.reduceColumns({
  reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true),
  selectors: ['PC_urban']
});
var nonUrbanPcMean = ee.Number(nonUrbanPcStats.get('mean'));
var nonUrbanPcSD   = ee.Number(nonUrbanPcStats.get('stdDev'));
var nonUrbanLower  = nonUrbanPcMean.subtract(nonUrbanPcSD.multiply(2));
var nonUrbanUpper  = nonUrbanPcMean.add(nonUrbanPcSD.multiply(2));

print('--- PC_urban NO URBANOS ---');
print('  Media:', nonUrbanPcMean, '  SD:', nonUrbanPcSD);
print('  Rango ±2SD: [', nonUrbanLower, ',', nonUrbanUpper, ']');

var nonUrbanFiltered = nonUrbanWithPCA.filter(ee.Filter.and(
  ee.Filter.gte('PC_urban', nonUrbanLower),
  ee.Filter.lte('PC_urban', nonUrbanUpper)
));

print('► No urbanas ANTES:', nonUrbanWithPCA.size());
print('► No urbanas DESPUÉS (±2SD):', nonUrbanFiltered.size());
print('► Eliminadas:', nonUrbanWithPCA.size().subtract(nonUrbanFiltered.size()));

// Diagnostic on the map
Map.addLayer(urbanWithPCA.filter(ee.Filter.or(
  ee.Filter.lt('PC_urban', urbanLower), ee.Filter.gt('PC_urban', urbanUpper)))
  .style({color:'FF0000', pointSize:4, pointShape:'cross'}),
  {}, 'Eliminados PCA — urbanas', false);
Map.addLayer(nonUrbanWithPCA.filter(ee.Filter.or(
  ee.Filter.lt('PC_urban', nonUrbanLower), ee.Filter.gt('PC_urban', nonUrbanUpper)))
  .style({color:'FF8C00', pointSize:4, pointShape:'cross'}),
  {}, 'Eliminados PCA — no urbanas', false);


// ============================================================
// STEP 5: BASE SAMPLE — STABLE PERIOD
// ============================================================
// From the 1500 PCA-filtered (~1425):
//   - 230 urban
//   - 460 non-urban
// Leftover non-urban → reserve for step 6b.
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 5: Base sample — stable period');
print('═══════════════════════════════════════════');

var urbanSorted = urbanFiltered
  .randomColumn('_rand_base', SEED)
  .sort('_rand_base');

var urbanSub = urbanSorted
  .limit(BASE_URBAN)
  .map(function(f) {
    return f.set({
      tipo_muestra: 'urbano_estable',
      paso: 'base_estable',
      periodo_asignado: 'estable_1985'
    });
  });

// PCA urban leftovers (filtered but not selected in the base)
var urbanLeftover = urbanSorted
  .filter(ee.Filter.gt('_rand_base',
    urbanSorted.limit(BASE_URBAN).aggregate_max('_rand_base')
  ));

var nonUrbanSorted = nonUrbanFiltered
  .randomColumn('_rand_base', SEED)
  .sort('_rand_base');

var nonUrbanSub = nonUrbanSorted
  .limit(BASE_NON_URBAN)
  .map(function(f) {
    return f.set({
      tipo_muestra: 'no_urbano_estable',
      paso: 'base_estable',
      periodo_asignado: 'estable_1985'
    });
  });

// PCA non-urban leftovers (filtered but not selected in the base)
var nonUrbanLeftover = nonUrbanSorted
  .filter(ee.Filter.gt('_rand_base',
    nonUrbanSorted.limit(BASE_NON_URBAN).aggregate_max('_rand_base')
  ));

var baseSamples = urbanSub.merge(nonUrbanSub);

print('Muestra base (periodo estable):', baseSamples.size());
print('  → Urbanas estables:', urbanSub.size());
print('  → No urbanas estables:', nonUrbanSub.size());
print('  → Sobrantes urbanos PCA:', urbanLeftover.size());
print('  → Sobrantes no-urbanos PCA:', nonUrbanLeftover.size());

// --- Export PCA leftovers as an independent asset ---
// These are the samples that PASSED the ±2SD filter but did NOT enter
// the base sample (230 urb / 460 non-urb).
// Example: 1500 → PCA → 1454 filtered → 230 base → 1224 leftover urb
//          1500 → PCA → 1450 filtered → 460 base →  990 leftover non-urb
// Both classes are combined into a single dataset with full PCA info.
var pcaLeftoverUrb = urbanLeftover.map(function(f) {
  return f.set({
    tipo_muestra: 'urbano_sobrante_pca',
    cell_id: celda_id
  });
});
var pcaLeftoverNoUrb = nonUrbanLeftover.map(function(f) {
  return f.set({
    tipo_muestra: 'no_urbano_sobrante_pca',
    cell_id: celda_id
  });
});
var pcaLeftoverAll = pcaLeftoverUrb.merge(pcaLeftoverNoUrb);

print('  ► Sobrantes PCA combinados:', pcaLeftoverAll.size());
print('    (urb:', pcaLeftoverUrb.size(), '+ no-urb:', pcaLeftoverNoUrb.size(), ')');

Export.table.toAsset({
  collection: pcaLeftoverAll,
  description: 'pca_sobrantes_celda_' + celda_id,
  assetId: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/pca_sobrantes/celda_' + celda_id
});

Export.table.toDrive({
  collection: pcaLeftoverAll,
  description: 'pca_sobrantes_celda_' + celda_id + '_csv',
  folder: 'MapBiomas_Mexico_Urban',
  fileNamePrefix: 'pca_sobrantes_celda_' + celda_id,
  fileFormat: 'CSV'
});

print('  ► Exportación PCA sobrantes configurada');


// ============================================================
// STEP 6: INCREMENT — GROWTH + EXTRA NON-URBAN
// ============================================================
// 6a. +70 urban growth samples (proportional to local %)
//     Generated directly from the GHS mask per period,
//     with the exact amount derived from growthNormalized × 70.
//     No intermediate pool is used.
// 6b. +140 non-urban from PCA leftovers
//
// Total: 300 urb + 600 non-urb = 900/cell (1:2)
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 6: Increment');
print('═══════════════════════════════════════════');

// --- 6a. Urban extras: generate directly per period ---
// Distributes EXTRA_URBAN (70) points across growth periods according
// to their local proportion (growthNormalized), sampling directly from
// each period's mask rather than pooling all growth pixels together.
// A JS array is used to iterate (we need JS seeds for sampleFromMask)
var extraUrbanList = growthOnlyKeysJs.map(function(k, i) {
  var code = parseInt(k);
  var proportion = ee.Number(growthNormalized.get(k));
  var nExtra     = proportion.multiply(EXTRA_URBAN).round().int();

  // Generate exactly nExtra points from the period mask
  // nExtra is an ee.Number (server-side), but sampleFromMask handles numPixels
  // server-side inside .sample(). A high overFactor compensates.
  var mask = urbanPeriodCell.eq(code);

  // We use a high overFactor (200) because nExtra can be very small (~5-10)
  // and .sample() with a low numPixels can return 0 points
  var withRandom = mask.selfMask().addBands(
    ee.Image.random(SEED + 20 + i).rename('random')
  );
  var sampled = withRandom.sample({
    region: geom, scale: 100,
    numPixels: 5000,  // Fixed oversampling, then limited
    seed: SEED + 20 + i,
    geometries: true
  }).sort('random').limit(nExtra);

  return sampled.map(function(f) {
    return f.set({
      periodo_urbano: code,
      periodo_label: growthPeriodLabelsJs[k],
      value: 1,
      tipo_muestra: 'urbano_crecimiento',
      paso: 'incremento_periodo_' + k,
      periodo_asignado: growthPeriodLabelsJs[k]
    });
  });
});

var extraUrban = ee.FeatureCollection(extraUrbanList).flatten().limit(EXTRA_URBAN);

print('Extras urbano (crecimiento):', extraUrban.size());

// Report per period
var acumuladoUrb = ee.Number(BASE_URBAN);
growthOnlyKeysJs.forEach(function(k) {
  var n = extraUrban.filter(ee.Filter.eq('periodo_urbano', parseInt(k))).size();
  acumuladoUrb = acumuladoUrb.add(n);
  var pct = ee.Number(growthNormalized.get(k)).multiply(1000).round().divide(10);
  print('  Periodo ' + k + ': +', n, ' (',
    ee.String(pct).cat('%)'), ' → urb acum:', acumuladoUrb);
});

// --- 6b. Non-urban extras from PCA leftovers ---
var extraNonUrban = nonUrbanLeftover
  .limit(EXTRA_NON_URBAN)
  .map(function(f) {
    return f.set({
      tipo_muestra: 'no_urbano_extra',
      paso: 'extra_no_urbano',
      periodo_asignado: 'estable_1985'
    });
  });

print('Extras no-urbano (sobrantes PCA):', extraNonUrban.size());

// --- COMBINE ---
var finalSamples = baseSamples
  .merge(extraUrban)
  .merge(extraNonUrban)
  .map(function(f) { return f.set('cell_id', celda_id); });


// ============================================================
// FINAL SUMMARY
// ============================================================

print('═══════════════════════════════════════════');
print('  FINAL SUMMARY — Cell ' + celda_id);
print('═══════════════════════════════════════════');

var nUE = finalSamples.filter(ee.Filter.eq('tipo_muestra', 'urbano_estable')).size();
var nUC = finalSamples.filter(ee.Filter.eq('tipo_muestra', 'urbano_crecimiento')).size();
var nNB = finalSamples.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_estable')).size();
var nNE = finalSamples.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_extra')).size();

print('Total:', finalSamples.size());
print('  URBANO:     ', nUE, ' + ', nUC, ' = ', nUE.add(nUC));
print('  NO URBANO:  ', nNB, ' + ', nNE, ' = ', nNB.add(nNE));
print('  Proporción ≈ 1:2');
print('Propiedades:', finalSamples.first().propertyNames());


// ============================================================
// VISUALIZATION
// ============================================================

Map.addLayer(finalSamples.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_estable'))
  .style({color:'4CAF50', pointSize:2}), {}, 'No-urb base (' + BASE_NON_URBAN + ')', true);
Map.addLayer(finalSamples.filter(ee.Filter.eq('tipo_muestra', 'no_urbano_extra'))
  .style({color:'81C784', pointSize:2}), {}, 'No-urb extra (+' + EXTRA_NON_URBAN + ')', true);
Map.addLayer(finalSamples.filter(ee.Filter.eq('tipo_muestra', 'urbano_estable'))
  .style({color:'1A1A2E', pointSize:3}), {}, 'Urb estables (' + BASE_URBAN + ')', true);
Map.addLayer(finalSamples.filter(ee.Filter.eq('tipo_muestra', 'urbano_crecimiento'))
  .style({color:'E94560', pointSize:3}), {}, 'Urb crecimiento (+' + EXTRA_URBAN + ')', true);

// Full seed samples (diagnostic)
Map.addLayer(seedUrbanStable.style({color:'9E9E9E', pointSize:1}),
  {}, 'Semilla urb (' + SEED_SAMPLES + ')', false);
Map.addLayer(seedNonUrbanStable.style({color:'BDBDBD', pointSize:1}),
  {}, 'Semilla no-urb (' + SEED_SAMPLES + ')', false);


// ============================================================
// STEP 7: EXPORT
// ============================================================

print('═══════════════════════════════════════════');
print('  STEP 7: Export');
print('═══════════════════════════════════════════');

Export.table.toAsset({
  collection: finalSamples,
  description: 'expansion_v4_celda_' + celda_id,
  assetId: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/expansion_v4/celda_' + celda_id
});

Export.table.toDrive({
  collection: finalSamples,
  description: 'expansion_v4_celda_' + celda_id + '_csv',
  folder: 'MapBiomas_Mexico_Urban',
  fileNamePrefix: 'expansion_v4_celda_' + celda_id,
  fileFormat: 'CSV'
});

print('Tareas configuradas. Ejecutar desde la pestaña Tasks.');


// ============================================================
// BATCH EXPORT: ALL CELLS (this one is under testing)
// ============================================================
// Runs only if RUN_BATCH = true (set in PARAMETERS above).
// Generates tasks for each cell of the grid.
// 2 assets are exported per cell:
//   1. pca_sobrantes/celda_X → PCA leftovers (filtered - base) both classes
//   2. expansion_v4/celda_X  → 900 final samples
//
// When finished, combine with:
//   var all = gridMx.aggregate_array('id').getInfo().map(function(id){
//     return ee.FeatureCollection('...expansion_v4/celda_' + id);
//   });
//   var merged = ee.FeatureCollection(all).flatten();
// ============================================================

if (RUN_BATCH) {

  var cellIds = gridMx.aggregate_array('id');
  cellIds.evaluate(function(ids) {
    print('Iniciando lote para ' + ids.length + ' celdas...');

    ids.forEach(function(cid) {
      var cellGeom = gridMx.filter(ee.Filter.eq('id', cid)).first().geometry();
      var cellPeriod = urbanPeriodClass.clip(cellGeom);

      // --- Local histogram ---
      var cellHist = cellPeriod.reduceRegion({
        reducer: ee.Reducer.frequencyHistogram(),
        geometry: cellGeom, scale: 100, maxPixels: 1e13, bestEffort: true
      });
      var hist = ee.Dictionary(cellHist.get('periodo_urbano'));

      // --- Normalized proportions ---
      var localGrowthTotal = sumHistogramKeys(hist, growthOnlyKeys);
      var localGrowthNorm = ee.Dictionary.fromLists(growthOnlyKeys,
        growthOnlyKeys.map(function(k) {
          return ee.Algorithms.If(localGrowthTotal.gt(0),
            ee.Number(hist.get(k, 0)).divide(localGrowthTotal), ee.Number(0));
        })
      );

      // --- P3: Generate stable samples ---
      function cellSample(mask, n, over, s) {
        var wr = mask.selfMask().addBands(ee.Image.random(s).rename('random'));
        return wr.sample({
          region: cellGeom, scale: 100, numPixels: n * over, seed: s, geometries: true
        }).sort('random').limit(n);
      }

      var uStable = cellSample(cellPeriod.eq(1), SEED_SAMPLES, 50, SEED)
        .map(function(f) { return f.set({periodo_urbano:1, periodo_label:'estable_urbano', value:1}); });
      var nStable = cellSample(cellPeriod.eq(0), SEED_SAMPLES, 50, SEED + 1)
        .map(function(f) { return f.set({periodo_urbano:0, periodo_label:'estable_no_urbano', value:0}); });

      // --- P4: dual PCA ±2SD ---
      var mcPCA = lib_pca.addPC1Urban(mosaic1986.select(PCA_BANDS).clip(cellGeom), cellGeom);

      var uPCA = mcPCA.sampleRegions({collection: uStable, scale: 30, geometries: true, tileScale: 16});
      var nPCA = mcPCA.sampleRegions({collection: nStable, scale: 30, geometries: true, tileScale: 16});

      // Urban ±2SD
      var uStats = uPCA.reduceColumns({
        reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true),
        selectors: ['PC_urban']});
      var uM = ee.Number(uStats.get('mean'));
      var uS = ee.Number(uStats.get('stdDev'));
      var uFilt = uPCA.filter(ee.Filter.and(
        ee.Filter.gte('PC_urban', uM.subtract(uS.multiply(2))),
        ee.Filter.lte('PC_urban', uM.add(uS.multiply(2)))));

      // Non-urban ±2SD
      var nStats = nPCA.reduceColumns({
        reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true),
        selectors: ['PC_urban']});
      var nM = ee.Number(nStats.get('mean'));
      var nS2 = ee.Number(nStats.get('stdDev'));
      var nFilt = nPCA.filter(ee.Filter.and(
        ee.Filter.gte('PC_urban', nM.subtract(nS2.multiply(2))),
        ee.Filter.lte('PC_urban', nM.add(nS2.multiply(2)))));

      // --- P5: Stable base ---
      var uSorted = uFilt.randomColumn('_r', SEED).sort('_r');
      var uBase = uSorted.limit(BASE_URBAN)
        .map(function(f) { return f.set({tipo_muestra:'urbano_estable', paso:'base_estable', periodo_asignado:'estable_1985'}); });
      var uLeft = uSorted.filter(ee.Filter.gt('_r',
        uSorted.limit(BASE_URBAN).aggregate_max('_r')));

      var nSorted = nFilt.randomColumn('_r', SEED).sort('_r');
      var nBase = nSorted.limit(BASE_NON_URBAN)
        .map(function(f) { return f.set({tipo_muestra:'no_urbano_estable', paso:'base_estable', periodo_asignado:'estable_1985'}); });
      var nLeft = nSorted.filter(ee.Filter.gt('_r',
        nSorted.limit(BASE_NON_URBAN).aggregate_max('_r')));

      var base = uBase.merge(nBase);

      // --- Export PCA leftovers (filtered - base) ---
      var sobrantesPCA = uLeft.map(function(f) {
        return f.set({tipo_muestra:'urbano_sobrante_pca', cell_id: cid});
      }).merge(nLeft.map(function(f) {
        return f.set({tipo_muestra:'no_urbano_sobrante_pca', cell_id: cid});
      }));
      Export.table.toAsset({
        collection: sobrantesPCA,
        description: 'pca_sobrantes_celda_' + cid,
        assetId: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/pca_sobrantes/celda_' + cid
      });

      // --- P6a: Urban growth extras ---
      var extraUrbList = ['2','3','4','5','6','7','8','9'].map(function(k, i) {
        var code = parseInt(k);
        var prop = ee.Number(localGrowthNorm.get(k));
        var nE = prop.multiply(EXTRA_URBAN).round().int();
        var mask = cellPeriod.eq(code);
        var wr = mask.selfMask().addBands(ee.Image.random(SEED + 20 + i).rename('random'));
        return wr.sample({
          region: cellGeom, scale: 100, numPixels: 5000, seed: SEED + 20 + i, geometries: true
        }).sort('random').limit(nE)
          .map(function(f) {
            return f.set({
              periodo_urbano: code, periodo_label: periodLabels.get(ee.Number(code).format('%d')),
              value: 1, tipo_muestra: 'urbano_crecimiento',
              paso: 'incremento_periodo_' + k,
              periodo_asignado: periodLabels.get(ee.Number(code).format('%d'))
            });
          });
      });
      var extraUrb = ee.FeatureCollection(extraUrbList).flatten().limit(EXTRA_URBAN);

      // --- P6b: Non-urban extras ---
      var extraNoUrb = nLeft.limit(EXTRA_NON_URBAN)
        .map(function(f) { return f.set({tipo_muestra:'no_urbano_extra', paso:'extra_no_urbano', periodo_asignado:'estable_1985'}); });

      // --- Combine and export ---
      var finalCell = base.merge(extraUrb).merge(extraNoUrb)
        .map(function(f) { return f.set('cell_id', cid); });

      Export.table.toAsset({
        collection: finalCell,
        description: 'expansion_v4_celda_' + cid,
        assetId: 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/expansion_v4/celda_' + cid
      });
    });

    print('Se crearon ' + (ids.length * 2) + ' tareas (' + ids.length + ' celdas × 2 assets)');
  });

}