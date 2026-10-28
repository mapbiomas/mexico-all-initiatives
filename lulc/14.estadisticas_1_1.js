// =============================================================================
// MapBiomas Mexico — Collection 1.1
// Transition areas (ha) by state and year pair (1985-2025)
// Version: 2026-10-15 (separate C1.1 outputs; VALID_CLASSES currently contains 16 codes, including 21)
// =============================================================================

var COLECCION = '1.1';

var YEAR_INI = 1985;
var YEAR_FIN = 2025;

// Final C1.1 product from 13.integracion_H2O_esp.js: mangrove/urban priority, regional
// integration, valid classes, H2O, spatial filtering, C1.0 gap filling, and final clipping.
var ASSET_LANDCOVER =
  'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/' +
  'classification-ft/MEX_integration_alequech_1_1_ft_v1';

var ASSET_STATES =
  'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/' +
  'Estados_CCL';

var FIELD_ID   = 'CVE_ENT';
var FIELD_NAME = 'NOMGEO';


// Examples:
//
// Process selected states:
// var STATE_IDS = ['04', '05', '06'];
//
// Process all states:
// var STATE_IDS = null;
//
// Rerun a single state:
// var STATE_IDS = ['05'];

var STATE_IDS = null;


// =============================================================================
// TRANSITION CONFIGURATION
// =============================================================================

// 'consecutive':
//   1985→1986, 1986→1987, ..., 2024→2025.
//
// 'reference':
//   Use only the year pairs defined in REFERENCE_PAIRS.

var TRANSITION_MODE = 'consecutive';

var REFERENCE_PAIRS = [
  [1985, 2025]
];

var CRS_AREA = 'EPSG:6372';
var SCALE    = 30;
// Increase TILE_SCALE if reductions exceed available memory.
var TILE_SCALE = 4;

var SPLIT_MODE = 'state';

// false:
//   Retain all positive class codes.
//   Flag transitions involving codes outside VALID_CLASSES as anomalies.
//   Class 21 is currently included in VALID_CLASSES and is therefore not flagged.
//
// true:
//   Retain only transitions between codes listed in VALID_CLASSES.
//   Apply class filtering before reduceRegion.

var STRICT_CLASSES = false;


// false:
//   Retain both persistence and change.
//
// true:
//   Retain only changes.

var ONLY_CHANGES = false;


// Class codes accepted by this statistics script (16 codes, including class 21).
// The integration script uses a 15-class legend without class 21 (mosaic of uses).
// VALID_CLASSES below currently retains 21, so it differs from CLASES_VALIDAS in 13.integracion_H2O_esp.js.
//
//   Forests: 88, 89, 3 | Mangrove: 5
//   Shrubland: 66 | Savanna/natural grassland: 45 | Wetland: 11
//   Cultivated pasture: 15 | Perennial crop: 36 | Annual crop: 19
//   Forest plantation: 9 | Mosaic of uses: 21
//   Urban: 24 | Non-vegetated area: 25
//   River/lake/ocean: 33 | Permanent ice and snow: 34

var VALID_CLASSES = [
  3,
  5,
  9,
  11,
  15,
  19,
  21,
  24,
  25,
  33,
  34,
  36,
  45,
  66,
  88,
  89
];


// =============================================================================
// EXPORT CONFIGURATION
// =============================================================================

// false: Run quality assurance only.
// true:  Create export tasks.

var LAUNCH_EXPORTS = true;

// Use a dedicated C1.1 folder and suffix to keep these CSV files separate from C1 outputs.
var DRIVE_FOLDER = 'GEE_export_1_1_ft_v1';

var EXPORT_PREFIX = 'MEX_cambio_area_ha';
var EXPORT_SUFFIX = '1_1_ft_v1';

// State and year pair for quality assurance (default state: Chiapas; null pair: last configured pair).
var QA_CVE  = '07';
var QA_PAIR = null;


// No further configuration is required below this line. -----------------------------


// =============================================================================
// INPUT DATA
// =============================================================================

var imgLC = ee.Image(ASSET_LANDCOVER);

var states = ee.FeatureCollection(ASSET_STATES);

var STATE_LIST = STATE_IDS ||
  states.aggregate_array(FIELD_ID).distinct().sort().getInfo();


// =============================================================================
// RASTERIZE STATES TO REDUCE GEOMETRY PROCESSING COST
// =============================================================================
//
// Reducing over a detailed state polygon requires Earth Engine to test pixel membership
// against a potentially complex geometry. At 30 m over an entire state, this can
// increase computation cost and contribute to timeout errors.
// Rasterize numeric state codes once and reuse the resulting image as a mask.
// This reduces repeated processing of the detailed vector boundaries.
//
// Run reduceRegion over the state's bounding rectangle and use the raster mask
// to restrict results to pixels belonging to that state.
// The rectangle defines the reduction extent; the mask defines state membership.
// State masks are reused for every year pair.

var statesNumeric = states.map(function(f) {
  return f.set('CVE_NUM', ee.Number.parse(f.get(FIELD_ID)));
});

// Single raster containing the numeric state code for each pixel
var stateCodeImage = statesNumeric
  .reduceToImage({
    properties: ['CVE_NUM'],
    reducer: ee.Reducer.first()
  })
  .rename('state_code')
  .toInt();


// Build the list of year pairs.

var PAIRS = [];

if (TRANSITION_MODE === 'consecutive') {

  for (var year = YEAR_INI; year < YEAR_FIN; year++) {
    PAIRS.push([year, year + 1]);
  }

} else if (TRANSITION_MODE === 'reference') {

  PAIRS = REFERENCE_PAIRS;

} else {

  throw new Error(
    'TRANSITION_MODE debe ser "consecutive" o "reference".'
  );
}


print('Colección:', COLECCION);
print('Asset de cobertura:', ASSET_LANDCOVER);
print('Clases válidas (' + VALID_CLASSES.length + '):', VALID_CLASSES);
print('Modo de transición:', TRANSITION_MODE);
print('Número de pares:', PAIRS.length);
print('Pares procesados:', PAIRS);
print('Número de estados:', STATE_LIST.length);
print('Estados procesados:', STATE_LIST);
print('Incluye permanencias:', !ONLY_CHANGES);


// =============================================================================
// CALCULATE TRANSITION AREAS
// =============================================================================

/*
 * For each year pair:
 *
 *   1. Read the two annual classification bands.
 *   2. Exclude pixels where either class code is zero or negative.
 *   3. Apply the raster state mask (stateMask).
 *   4. Encode each transition as:
 *
 *        transition = initial_class * 1000 + final_class
 *
 *   5. Sum pixel area by transition code.
 *   6. Convert square meters to hectares.
 *
 * Examples:
 *
 *   3 -> 3  = 3003   persistence
 *   3 -> 15 = 3015   change
 *  89 -> 3  = 89003  change
 */

var transitionArea = function(stateMask, regionGeom, yearA, yearB, extra) {

  var classA = imgLC
    .select('classification_' + yearA)
    .rename('class_ini');

  var classB = imgLC
    .select('classification_' + yearB)
    .rename('class_fin');


  // Initial mask: retain positive class codes in both years and restrict pixels to the state.

  var validMask = classA.gt(0)
    .and(classB.gt(0))
    .and(stateMask);


  // When STRICT_CLASSES is true, retain only codes listed in VALID_CLASSES.

  if (STRICT_CLASSES) {

    var classValues = ee.List(VALID_CLASSES);

    var validValues = ee.List.repeat(
      1,
      classValues.length()
    );

    var validA = classA
      .remap(classValues, validValues, 0)
      .eq(1);

    var validB = classB
      .remap(classValues, validValues, 0)
      .eq(1);

    validMask = validMask
      .and(validA)
      .and(validB);
  }


  // Encode the initial and final classes as one transition code.

  var transition = classA
    .multiply(1000)
    .add(classB)
    .rename('trans')
    .updateMask(validMask)
    .toInt32();


  // Actual pixel area in square meters.

  var areaImage = ee.Image
    .pixelArea()
    .rename('area_m2')
    .updateMask(validMask)
    .addBands(transition);


  // Sum pixel area by transition code.
  // Use the state bounds as geometry; stateMask supplies the detailed state boundary.

  var reduction = areaImage.reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'trans'
    }),
    geometry: regionGeom,
    scale: SCALE,
    crs: CRS_AREA,
    bestEffort: false,
    maxPixels: 1e13,
    tileScale: TILE_SCALE
  });


  // Return an empty list if the reduction produces no valid groups.

  var groups = ee.List(
    ee.Algorithms.If(
      reduction.contains('groups'),
      reduction.get('groups'),
      ee.List([])
    )
  );


  // Convert each transition group to a table row.

  return groups.map(function(item) {

    item = ee.Dictionary(item);

    var transitionCode = ee.Number(item.get('trans')).int();

    var classIni = transitionCode
      .divide(1000)
      .floor()
      .int();

    var classFin = transitionCode
      .mod(1000)
      .int();

    var validIni = ee.List(VALID_CLASSES).contains(classIni);
    var validFin = ee.List(VALID_CLASSES).contains(classFin);

    // Use nested conditionals because ee.List.contains() results do not expose .and().
    var anomaly = ee.Algorithms.If(
      validIni,
      ee.Algorithms.If(validFin, 0, 1),
      1
    );

    return ee.Feature(
      null,
      ee.Dictionary(extra)
        .set('coleccion', COLECCION)
        .set('year_ini', yearA)
        .set('year_fin', yearB)
        .set('class_ini', classIni)
        .set('class_fin', classFin)
        .set('transition', transitionCode)
        .set(
          'area_ha',
          ee.Number(item.get('sum')).divide(10000)
        )
        .set(
          'es_cambio',
          classIni.neq(classFin)
        )
        .set(
          'anomalia',
          anomaly
        )
    );
  });
};


// =============================================================================
// FINAL FILTER
// =============================================================================

var aplicarFiltros = function(collection) {

  var result = ee.FeatureCollection(collection);

  if (ONLY_CHANGES) {
    result = result.filter(
      ee.Filter.eq('es_cambio', 1)
    );
  }

  return result;
};


// =============================================================================
// CSV COLUMNS
// =============================================================================

var SELECTORS = [
  'coleccion',
  'cve_ent',
  'nomgeo',
  'year_ini',
  'year_fin',
  'class_ini',
  'class_fin',
  'transition',
  'area_ha',
  'es_cambio',
  'anomalia'
];


// =============================================================================
// CREATE EXPORT TASKS
// =============================================================================

STATE_LIST.forEach(function(cve) {

  var stateFeature = states
    .filter(ee.Filter.eq(FIELD_ID, cve))
    .first();

  var stateBoundsGeom = stateFeature.geometry().bounds();

  var cveNum = parseInt(cve, 10);
  var stateMask = stateCodeImage.eq(cveNum);

  var extraProperties = {
    cve_ent: stateFeature.get(FIELD_ID),
    nomgeo: stateFeature.get(FIELD_NAME)
  };


  // One export per state and year pair.

  if (SPLIT_MODE === 'state_pair') {

    PAIRS.forEach(function(pair) {

      if (!LAUNCH_EXPORTS) {
        return;
      }

      var tag =
        cve + '_' +
        pair[0] + '_' +
        pair[1] + '_' +
        EXPORT_SUFFIX;

      var exportName =
        EXPORT_PREFIX + '_' + tag;

      var pairCollection = aplicarFiltros(
        transitionArea(
          stateMask,
          stateBoundsGeom,
          pair[0],
          pair[1],
          extraProperties
        )
      );

      Export.table.toDrive({
        collection: pairCollection,
        description: exportName,
        folder: DRIVE_FOLDER,
        fileNamePrefix: exportName,
        fileFormat: 'CSV',
        selectors: SELECTORS
      });
    });


  // One export per state containing all year pairs.

  } else {

    var stateRows = ee.List([]);

    PAIRS.forEach(function(pair) {

      stateRows = stateRows.cat(
        transitionArea(
          stateMask,
          stateBoundsGeom,
          pair[0],
          pair[1],
          extraProperties
        )
      );
    });

    var stateCollection = aplicarFiltros(stateRows);

    if (LAUNCH_EXPORTS) {

      var exportName =
        EXPORT_PREFIX + '_' +
        cve + '_' +
        EXPORT_SUFFIX;

      Export.table.toDrive({
        collection: stateCollection,
        description: exportName,
        folder: DRIVE_FOLDER,
        fileNamePrefix: exportName,
        fileFormat: 'CSV',
        selectors: SELECTORS
      });
    }
  }
});


// =============================================================================
// TASK SUMMARY
// =============================================================================

var numberOfTasks = SPLIT_MODE === 'state_pair'
  ? STATE_LIST.length * PAIRS.length
  : STATE_LIST.length;

print(
  'Modo de división:',
  SPLIT_MODE,
  '| Número de tareas:',
  numberOfTasks,
  LAUNCH_EXPORTS
    ? '| Exports LANZADOS'
    : '| Exports NO lanzados; solamente QA'
);

print('Carpeta de salida:', DRIVE_FOLDER);
print('Sufijo de salida:', EXPORT_SUFFIX);


// =============================================================================
// QUALITY ASSURANCE
// =============================================================================

var qaCve  = QA_CVE  || STATE_LIST[0];
var qaPair = QA_PAIR || PAIRS[PAIRS.length - 1];

var qaState = states
  .filter(ee.Filter.eq(FIELD_ID, qaCve))
  .first();

var qaStateBoundsGeom = qaState.geometry().bounds();
var qaStateMask = stateCodeImage.eq(parseInt(qaCve, 10));

var qaCollection = aplicarFiltros(
  transitionArea(
    qaStateMask,
    qaStateBoundsGeom,
    qaPair[0],
    qaPair[1],
    {
      cve_ent: qaState.get(FIELD_ID),
      nomgeo: qaState.get(FIELD_NAME)
    }
  )
);


// Inspect asset bands: expect classification_YYYY for 1985-2025.

print('QA — bandas del asset C1.1:', imgLC.bandNames());


// Display the 50 transitions with the largest areas.

print(
  'QA — Estado ' +
    qaCve + ' | ' +
    qaPair[0] + '→' + qaPair[1] +
    ' | 50 superficies mayores:',
  qaCollection
    .sort('area_ha', false)
    .limit(50)
);


// Total area by change status: es_cambio=0 means persistence; es_cambio=1 means change.

print(
  'QA — área total en ha: cambio vs permanencia:',
  qaCollection.reduceColumns({
    reducer: ee.Reducer.sum().group({
      groupField: 1,
      groupName: 'es_cambio'
    }),
    selectors: [
      'area_ha',
      'es_cambio'
    ]
  })
);


// Transitions involving codes outside VALID_CLASSES; class 21 is currently accepted.

print(
  'QA — transiciones anómalas:',
  qaCollection
    .filter(ee.Filter.eq('anomalia', 1))
    .aggregate_array('transition')
    .distinct()
    .sort()
);
