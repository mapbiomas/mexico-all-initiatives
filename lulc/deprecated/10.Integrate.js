// DEPRECATED: Part of the MapBiomas Mexico Collection 1.0 data flow; retained for historical reference.
// Versión script 20/07/2026
// National integration of the 5 physiographic-region classifications into a
// single mosaic (1985-2025), using a hard clip per region (no qualityMosaic)

// Description:
// Each regional asset (classification and probability) is clipped to its
// physiographic province and combined with mosaic(). No priority rule is
// needed because provinces partition the territory without overlap.
// Outputs the integrated classification and probability to classification-ft/.

// Note:
// Bands are homogenized to 41 per year (classification_YYYY / probability_YYYY)
// before mosaicking, so regional assets with different band sets still align.

// # User variables----
// Define your name
var name_x = 'alequech';

// Define the output version
var version_out = '1';

// ## Series range and visualization year
var startYear = 1985;
var endYear = 2025;
var yearVis = 2025;                 // Year used for QA histogram and display

// ## Class reassignment (classification only): [from, to]
var reassign = [[24, 23]];

// # Asset paths----
var path = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/';
var classFolder = path + 'classification/';
var classFolderOut = path + 'classification-ft/';

// # Vector inputs----
// Physiographic provinces (field 'Region', values 1-5) and national boundary
var regions = ee.FeatureCollection(path + 'provincias_fisiograficas_mexico_MG');
var limiteMex = ee.FeatureCollection(path + 'Limite_Mex_INEGI_2025_CCL');
print('Available regions:', regions.aggregate_array('Region'));

// # Regional assets----
// Classification and probability asset per region (1-5)
var assetsByRegion = [
  {region: 1, classification: classFolder + 'MEX_classification_1_alequech_v1', probability: classFolder + 'MEX_probability_1_alequech_v1'},
  {region: 2, classification: classFolder + 'MEX_classification_2_Region2_v1', probability: classFolder + 'MEX_probability_2_Region2_v1'},
  {region: 3, classification: classFolder + 'MEX_classification_3_fgj_v2',     probability: classFolder + 'MEX_probability_3_fgj_v2'},
  {region: 4, classification: classFolder + 'MEX_classification_4_jvsv_v1',    probability: classFolder + 'MEX_probability_4_jvsv_v1'},
  {region: 5, classification: classFolder + 'MEX_classification_5_alequech_v1', probability: classFolder + 'MEX_probability_5_alequech_v1'}
];

// # Palette and visualization parameters----
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');
var paletteArr = vis.palette;

var visLulc = {min: 0, max: paletteArr.length - 1, palette: paletteArr};
var visProb = {min: 0, max: 1, palette: ['440154', '414487', '2a788e', '22a884', '7ad151', 'fde725']};

// ## Legend data: [class_id, name, group]
var legendData = [
  [88, 'Bosque Templado',                   '1. Bosques'],
  [89, 'Bosque Tropical seco',              '1. Bosques'],
  [3,  'Bosques Tropicales húmedos',        '1. Bosques'],
  [5,  'Manglares',                         '1. Bosques'],
  [66, 'Matorrales',                        '2. Veget herbácea y arbustiva'],
  [45, 'Sabanas y pastizales naturales',    '2. Veget herbácea y arbustiva'],
  [11, 'Inundables',                        '2. Veget herbácea y arbustiva'],
  [15, 'Pastizales cultivados e inducidos', '3. Agropecuario'],
  [36, 'Cultivo perenne',                   '3. Agropecuario'],
  [19, 'Cultivos anuales',                  '3. Agropecuario'],
  [9,  'Plantación forestal',               '3. Agropecuario'],
  [21, 'Mosaico de usos',                   '3. Agropecuario'],
  [24, 'Área urbana y construída',          '4. No Vegetado'],
  [25, 'Áreas sin vegetación',              '4. No Vegetado'],
  [33, 'Ríos, lagos y mares',               '5. Cuerpos de agua'],
  [34, 'Glaciares',                         '5. Cuerpos de agua'],
  [27, 'No observado',                      '6. No observado']
];

// Do not need to move anything else from here on -----

// # Band normalization----
// Build the canonical band lists (one per year) and homogenize every asset to
// 41 bands before mosaicking, filling missing bands with a masked (nodata) band
var years = ee.List.sequence(startYear, endYear);

var classBands = years.map(function(y){
  return ee.String('classification_').cat(ee.Number(y).round().int().format());
});
var probBands = years.map(function(y){
  return ee.String('probability_').cat(ee.Number(y).round().int().format());
});

// Pad an image to the given band list, keeping canonical order and names
var padBands = function(img, bandList) {
  return ee.ImageCollection(bandList.map(function(b){
    b = ee.String(b);
    var has = img.bandNames().contains(b);
    return ee.Image(ee.Algorithms.If(
      has,
      img.select([b]),
      ee.Image().rename([b]).updateMask(ee.Image(0))
    ));
  })).toBands().rename(bandList);
};

// # Clip per region and mosaic----
// Clip each asset to its province; the national mosaic needs no priority rule
// because provinces do not overlap
var clippedClass = assetsByRegion.map(function(item) {
  var regionGeom = regions.filter(ee.Filter.eq('Region', item.region));
  Map.addLayer(regionGeom, {}, 'Region ' + item.region, false);
  return padBands(ee.Image(item.classification), classBands).clip(regionGeom);
});

var clippedProb = assetsByRegion.map(function(item) {
  var regionGeom = regions.filter(ee.Filter.eq('Region', item.region));
  return padBands(ee.Image(item.probability), probBands).clip(regionGeom);
});

var mosaicClass = ee.ImageCollection.fromImages(clippedClass).mosaic();
var mosaicProb = ee.ImageCollection.fromImages(clippedProb).mosaic();

// Apply class reassignment (classification only)
reassign.forEach(function(pair){
  mosaicClass = mosaicClass.where(mosaicClass.eq(pair[0]), pair[1]);
});

// # QA before export----
// Class histogram for the target year at coarse scale (1000 m) to verify
// present classes and detect invalid values before launching the task
var histograma = mosaicClass.select('classification_' + yearVis)
  .reduceRegion({
    reducer: ee.Reducer.frequencyHistogram().unweighted(),
    geometry: limiteMex.geometry(),
    scale: 1000,
    maxPixels: 1e13
  });
print('class histogram ' + yearVis + ' (scale 1000)', histograma);

// # Visualization----
// selfMask() avoids the white veil from unmasked zero-value pixels
Map.addLayer(mosaicClass.select('classification_' + yearVis).selfMask(), visLulc, 'classification_' + yearVis + ' mosaic', false);
Map.addLayer(mosaicProb.select('probability_' + yearVis), visProb, 'probability_' + yearVis + ' mosaic', false);

// ## Legend panel (grouped by category)
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px'}});
legend.add(ui.Label({
  value: 'Cubiertas y usos del suelo',
  style: {fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0', padding: '0'}
}));

var makeRow = function(color, name) {
  var colorBox = ui.Label({
    style: {backgroundColor: color, padding: '8px', margin: '0 0 4px 0'}
  });
  var description = ui.Label({value: name, style: {margin: '0 0 4px 6px'}});
  return ui.Panel({widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal')});
};

var currentGroup = '';
legendData.forEach(function(item) {
  var classId = item[0];
  var className = item[1];
  var groupName = item[2];
  if (groupName !== currentGroup) {
    legend.add(ui.Label({
      value: groupName,
      style: {fontWeight: 'bold', fontSize: '13px', margin: '6px 0 2px 0'}
    }));
    currentGroup = groupName;
  }
  legend.add(makeRow(paletteArr[classId], classId + '. ' + className));
});

Map.add(legend);

// # Exports----
// bounds() avoids the "Request payload size exceeds the limit" error: the Code
// Editor embeds the region coordinates in the task, and the detailed INEGI
// boundary exceeds 10 MB. The mosaic is already masked by the regional clips,
// so a bounding rectangle is enough.
var regionExp = limiteMex.geometry().bounds();

var classOutName = 'MEX_integration_' + name_x + '_clip_v' + version_out;
var probOutName = 'MEX_integration_probability_' + name_x + '_clip_v' + version_out;

// Classification: 'mode' pyramiding (categorical values)
Export.image.toAsset({
  image: mosaicClass,
  description: classOutName,
  assetId: classFolderOut + classOutName,
  scale: 30,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: regionExp,
  overwrite: true
});

// Probability: 'mean' pyramiding (continuous values)
Export.image.toAsset({
  image: mosaicProb,
  description: probOutName,
  assetId: classFolderOut + probOutName,
  scale: 30,
  pyramidingPolicy: {'.default': 'mean'},
  maxPixels: 1e13,
  region: regionExp,
  overwrite: true
});
