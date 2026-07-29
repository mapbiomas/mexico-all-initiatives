/*
================================================================================
MAPBIOMAS MEXICO - ENRICHED MOSAICS, NORTH-CENTRAL REGION
Collection 1 - Urban theme
================================================================================

Description:
Generates annual mosaics for the North-Central (Centro-Norte) subzone of the geostatistical
grid, adding to the base production mosaic the following blocks of variables
inherited from the comparative test v0.08:

  Block B  - 8 additional spectral indices
              BLFEI, BRBA, NBAI, PISI, VIBI, VgNIRBI, VrNIRBI, IBI
  Block C1 - 6 arid indices WITHOUT TIR
              IISI, MBAI, BAEM, DBSI, MBI, MNDBaI
  Block C2 - 5 arid indices WITH TIR  (toggle INCLUDE_TIR)
              DULI1, DULI2, DULI3, DBI, NBLI
  Textures  - 10 GLCM metrics over NIR, 5x5 and 11x11 windows
              (toggle INCLUDE_TEXTURES — heaviest step of the pipeline)

NOTE: NDBI, UI, EBBI, NDVI, SAVI, MNDWI already come in the base mosaic
      and are NOT recomputed.

Critical conventions (inherited from test v0.08):
- EPS = 1e-6 in ALL denominators (do not remove)
- OPT_SCALE = 10000 when mixing optical (Landsat C1) with TIR (Kelvin)
- GLCM requires ee.Image.toInt() ; size=R produces a (2R+1)x(2R+1) window
- Landsat TIR: year <= 2012 → L5 ST_B6 ; year >= 2013 → L8/L9 ST_B10
- Official Collection 2 L2 scaling: DN x 0.00341802 + 149.0  → Kelvin
- MBI != MBSI: the correct formula is Nguyen et al. 2021

Output:
  projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/MOSAICS/CENTRO-NORTE/
================================================================================
*/

// ============================================================================
// MODULES
// ============================================================================
var mosaicProd = require("users/edimilsonrodriguessantos/mapbiomas:Col10/classificacao/mosaic_production.js");

// ============================================================================
// GENERAL PARAMETERS
// ============================================================================
var version  = 1;
var dirout   = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/Urban/COLLECTION-1/MOSAICS/CENTRO-NORTE';

// Grid subzone
var SUBZONA    = 'centro-norte';
var regionName = 'centro_norte';

// Toggles for optional blocks
var INCLUDE_TIR      = true;   // adds DULI1/2/3, DBI, NBLI (queries Landsat thermal)
var INCLUDE_TEXTURES = true;   // adds 10 GLCM bands (heaviest operation)

// Safety flag: if true, does NOT launch exports and only shows a preview
// of the TEST_YEAR mosaic (useful to validate bands before queueing tasks)
var PREVIEW_ONLY = false;
var TEST_YEAR    = 2020;

// Numeric constants
var EPS       = 1e-6;
var OPT_SCALE = 10000;  // ASSUMPTION about the mosaic scale, validate against real values

// ============================================================================
// MOSAIC AREA
// ============================================================================
var gridMx = ee.FeatureCollection(
  'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/Samples/malla_geoestadistica_sel_id_zona_vecinos'
);
var gridSubzona = gridMx.filter(ee.Filter.eq('subzonas', SUBZONA));
var region      = gridSubzona.geometry();

// Range of years to process (adjust if you want to run in batches)
var activeYears = ee.List.sequence(1985, 2025).getInfo();

// ============================================================================
// BLOCK B — 8 spectral indices from base bands
// ============================================================================
function addExtraIndices(img) {
  var B  = img.select('BLUE');
  var G  = img.select('GREEN');
  var R  = img.select('RED');
  var N  = img.select('NIR');
  var S1 = img.select('SWIR1');
  var S2 = img.select('SWIR2');

  // BLFEI = ((G+R+S2)/3 - S1) / ((G+R+S2)/3 + S1)
  var visMean = G.add(R).add(S2).divide(3);
  var blfei = visMean.subtract(S1)
    .divide(visMean.add(S1).add(EPS))
    .rename('BLFEI');

  // BRBA = R / S1
  var brba = R.divide(S1.add(EPS)).rename('BRBA');

  // NBAI = (S2 - S1/G) / (S2 + S1/G)
  var s1g = S1.divide(G.add(EPS));
  var nbai = S2.subtract(s1g)
    .divide(S2.add(s1g).add(EPS))
    .rename('NBAI');

  // PISI = 0.8192·B - 0.5735·N + 0.0750
  var pisi = B.multiply(0.8192)
    .subtract(N.multiply(0.5735))
    .add(0.0750)
    .rename('PISI');

  // VIBI = NDVI / (NDVI + NDBI)
  var ndvi = img.select('NDVI');
  var ndbi = img.select('NDBI');
  var vibi = ndvi
    .divide(ndvi.add(ndbi).add(EPS))
    .rename('VIBI');

  // VgNIRBI = (G - N) / (G + N)
  var vgnirbi = G.subtract(N).divide(G.add(N).add(EPS)).rename('VgNIRBI');

  // VrNIRBI = (R - N) / (R + N)
  var vrnirbi = R.subtract(N).divide(R.add(N).add(EPS)).rename('VrNIRBI');

  // IBI = (NDBI - partA) / (NDBI + partA)
  // where partA = (SAVI + (G - S1)/(G + S1)) / 2 ; SAVI already comes in the mosaic
  var savi  = img.select('SAVI');
  var gs1n  = G.subtract(S1).divide(G.add(S1).add(EPS));
  var partA = savi.add(gs1n).divide(2);
  var ibi   = ndbi.subtract(partA)
    .divide(ndbi.add(partA).add(EPS))
    .rename('IBI');

  return img.addBands([blfei, brba, nbai, pisi, vibi, vgnirbi, vrnirbi, ibi]);
}

// ============================================================================
// BLOCK C1 — 6 arid indices WITHOUT TIR
// ============================================================================
function addNewIndicesNoTIR(img) {
  var G  = img.select('GREEN');
  var N  = img.select('NIR');
  var S1 = img.select('SWIR1');
  var S2 = img.select('SWIR2');

  // Versions normalized to reflectance [0-1]
  var NIRn = N.divide(OPT_SCALE);
  var S1n  = S1.divide(OPT_SCALE);

  var ndvi = img.select('NDVI');
  var ndbi = img.select('NDBI');
  var savi = img.select('SAVI');

  // IISI = 1e8 / sqrt(NIRn² + (1 - S1n)²)   [requires reflectance 0-1]
  var iisiDen = NIRn.pow(2)
    .add(ee.Image(1).subtract(S1n).pow(2))
    .sqrt()
    .add(EPS);
  var iisi = ee.Image(1e8).divide(iisiDen).rename('IISI');

  // MBAI = (N + 1.57·G + 2.4·S1) / (1 + N) × 1e-6
  var mbai = N.add(G.multiply(1.57)).add(S1.multiply(2.4))
    .divide(N.add(1).add(EPS))
    .multiply(1e-6)
    .rename('MBAI');

  // BAEM = NDBI - (SAVI + MNDWI)/2 ; MNDWI = (G - S1)/(G + S1)
  var mndwi = G.subtract(S1).divide(G.add(S1).add(EPS));
  var baem  = ndbi.subtract(savi.add(mndwi).divide(2)).rename('BAEM');

  // DBSI = (S1 - G)/(S1 + G) - NDVI
  var dbsi = S1.subtract(G)
    .divide(S1.add(G).add(EPS))
    .subtract(ndvi)
    .rename('DBSI');

  // MBI (Nguyen et al. 2021) = (S1 - S2 - N) / (S1 + S2 + N) + 0.5
  //  "MBSI" =  MBI
  var mbi = S1.subtract(S2).subtract(N)
    .divide(S1.add(S2).add(N).add(EPS))
    .add(0.5)
    .rename('MBI');

  // MNDBaI = (S2 - S1) / (S2 + S1)
  var mndbai = S2.subtract(S1).divide(S2.add(S1).add(EPS)).rename('MNDBaI');

  return img.addBands([iisi, mbai, baem, dbsi, mbi, mndbai]);
}

// ============================================================================
// THERMAL BAND — annual median in Kelvin
// ============================================================================
function getTIRForYear(year, regionGeom) {
  var collection;
  var tirBand;

  if (year <= 2012) {
    // Landsat 5 (1985-2012)
    collection = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2');
    tirBand    = 'ST_B6';
  } else {
    // Landsat 8 + Landsat 9 (2013-2025)
    var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
    var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');
    collection = l8.merge(l9);
    tirBand    = 'ST_B10';
  }

  var startDate = ee.Date.fromYMD(year, 1, 1);
  var endDate   = ee.Date.fromYMD(year, 12, 31);

  var tir = collection
    .filterBounds(regionGeom)
    .filterDate(startDate, endDate)
    .filter(ee.Filter.lt('CLOUD_COVER', 30))
    .select(tirBand)
    .median()
    .multiply(0.00341802).add(149.0)
    .rename('TIR');

  return tir;
}

// ============================================================================
// BLOCK C2 — 5 arid indices WITH TIR
// ============================================================================
function addNewIndicesTIR(img, tir) {
  var B  = img.select('BLUE');
  var R  = img.select('RED');
  var S1 = img.select('SWIR1');
  var S2 = img.select('SWIR2');

  // Versions normalized to reflectance [0-1] to mix with TIR (Kelvin)
  var Bn = B.divide(OPT_SCALE);
  var Rn = R.divide(OPT_SCALE);

  var ndvi = img.select('NDVI');
  var ndbi = img.select('NDBI');

  // Normalized base block (Bn - T)/(Bn + T)
  var bnT = Bn.subtract(tir).divide(Bn.add(tir).add(EPS));

  // DULI1 = (Bn - T)/(Bn + T) - NDBI - NDVI
  var duli1 = bnT.subtract(ndbi).subtract(ndvi).rename('DULI1');

  // DULI2 = (Bn - T)/(Bn + T) - NDBI
  var duli2 = bnT.subtract(ndbi).rename('DULI2');

  // DULI3 = DULI1 - (S1 - S2)/(S1 + S2)
  var s1s2  = S1.subtract(S2).divide(S1.add(S2).add(EPS));
  var duli3 = duli1.subtract(s1s2).rename('DULI3');

  // DBI = (Bn - T)/(Bn + T) - NDVI
  var dbi = bnT.subtract(ndvi).rename('DBI');

  // NBLI = (Rn - T)/(Rn + T)
  var nbli = Rn.subtract(tir).divide(Rn.add(tir).add(EPS)).rename('NBLI');

  return img.addBands([duli1, duli2, duli3, dbi, nbli]);
}

// ============================================================================
// GLCM TEXTURES — 10 bands over NIR (5x5 and 11x11 windows)
// ============================================================================
function addNIRTextures(img) {
  // GLCM requires integers
  var nirInt = img.select('NIR').toInt();

  // size=R → (2R+1)x(2R+1) window
  var glcm5  = nirInt.glcmTexture({size: 2});  // 5x5
  var glcm11 = nirInt.glcmTexture({size: 5});  // 11x11

  // 5 canonical metrics: ASM, contrast, var, idm, ent
  var origNames = ['NIR_asm', 'NIR_contrast', 'NIR_var', 'NIR_idm', 'NIR_ent'];
  var names5    = ['NIR_asm_5',  'NIR_contrast_5',  'NIR_var_5',  'NIR_idm_5',  'NIR_ent_5'];
  var names11   = ['NIR_asm_11', 'NIR_contrast_11', 'NIR_var_11', 'NIR_idm_11', 'NIR_ent_11'];

  var t5  = glcm5.select(origNames, names5);
  var t11 = glcm11.select(origNames, names11);

  return img.addBands([t5, t11]);
}

// ============================================================================
// PER-YEAR PIPELINE
// ============================================================================
function buildEnrichedMosaic(year) {
  var mosaic = mosaicProd.mosaicGen(year, region).clip(region);

  // Block B — 8 base indices
  mosaic = addExtraIndices(mosaic);

  // Block C1 — 6 arid indices without TIR
  mosaic = addNewIndicesNoTIR(mosaic);

  // Block C2 — 5 arid indices with TIR (optional)
  if (INCLUDE_TIR) {
    var tir = getTIRForYear(year, region);
    mosaic = addNewIndicesTIR(mosaic, tir);
  }

  // GLCM textures (optional, heaviest step)
  if (INCLUDE_TEXTURES) {
    mosaic = addNIRTextures(mosaic);
  }

  return mosaic;
}

// ============================================================================
// INITIAL LOG
// ============================================================================
print('==== Mosaicos enriquecidos centro-norte ====');
print('Subzona:', SUBZONA);
print('Número de celdas en la subzona:', gridSubzona.size());
print('Años a procesar:', activeYears.length, activeYears);
print('Toggles → INCLUDE_TIR:', INCLUDE_TIR, '| INCLUDE_TEXTURES:', INCLUDE_TEXTURES);
print('Modo:', PREVIEW_ONLY ? 'PREVIEW (sin export)' : 'EXPORT BATCH');

// ============================================================================
// PREVIEW MODE — validate bands before launching 41 exports
// ============================================================================
if (PREVIEW_ONLY) {
  var testMosaic = buildEnrichedMosaic(TEST_YEAR);
  print('Bandas del mosaico ' + TEST_YEAR + ':', testMosaic.bandNames());
  print('Número total de bandas:', testMosaic.bandNames().size());

  Map.centerObject(gridSubzona, 6);
  Map.addLayer(gridSubzona, {color: 'red'}, 'Subzona ' + SUBZONA, false);
  Map.addLayer(
    testMosaic,
    {bands: ['SWIR1', 'NIR', 'RED'], min: 0, max: 3000},
    'Falso color SWIR1-NIR-RED ' + TEST_YEAR
  );
  Map.addLayer(
    testMosaic,
    {bands: ['RED', 'GREEN', 'BLUE'], min: 0, max: 2000},
    'Color natural ' + TEST_YEAR,
    false
  );
}

// ============================================================================
// BATCH EXPORT
// ============================================================================
if (!PREVIEW_ONLY) {
  activeYears.forEach(function(year) {
    var mosaic      = buildEnrichedMosaic(year);
    var description = 'mosaic_mexico_' + regionName + '_urban_' + year + '_v' + version;
    var assetId     = dirout + '/' + description;

    Export.image.toAsset({
      image: mosaic.set({
        'year':         year,
        'version':      version,
        'territory':    'MEXICO',
        'theme':        'Urban Area',
        'collection':   1,
        'subzona':      SUBZONA,
        'has_tir':      INCLUDE_TIR ? 1 : 0,
        'has_textures': INCLUDE_TEXTURES ? 1 : 0
      }),
      description:      description,
      assetId:          assetId,
      region:           region,
      scale:            30,
      maxPixels:        1e13,
      pyramidingPolicy: {'.default': 'mean'}
    });
    print('Tarea lanzada:', description);
  });
}
