// This palette does not match our current classes, making a new one
// var palettes = require('users/mapbiomas/modules:Palettes.js');
// var visLULC = {'min': 0,'max': 69, 'palette': palettes.get('classification9')};

// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// Inputs
var region_name = 4,
    subregion_names = [12,13,14,15],
    sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/',
    country_name = 'MEX',
    stable_file_name = 'Stable_Map',
    name_x = 'jvsv',
    stable_version = 1,
    // outputs mosaic
    stable_version_out = 1,
    stable_file_name_out = 'Stable_Map',
    stableName  = country_name + '_' + stable_file_name_out + '_' + region_name + '_' + name_x + '_v' + stable_version_out;

// Build the name of the classification input 
var class_name = [];
for(var i=0; i<subregion_names.length; i++){
  class_name[i] = sample_folder + country_name + "_" + stable_file_name + "_" + region_name + "_" + subregion_names[i] + "_" + name_x + "_v"+stable_version;
}
print('class_name', class_name);

// Read classified image    
var stable = ee.ImageCollection.fromImages(class_name.map(function(loc){
  return ee.Image(loc);
})).mosaic();

// Create visualization parameters for LULC map
var visLulc = {min: 0, 
  max: 89, 
  palette: auxFuncs.paleta,
  opacity: 1
};

// Read region
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
var region = regions.filter(ee.Filter.eq('Region', region_name));

// Region poly
Map.addLayer(region,
  {}, 
  'Region '+ region_name);

// Region estables series del INEGI
var empty = ee.Image().byte();
var fills = empty.paint({
  featureCollection: polis,
  color: 'clase_mb_i' // Property name containing numeric codes
});

var palette = ee.List(polis.aggregate_array('color_ac')).distinct().getInfo();
print('palette', palette);
var valores = ee.List(polis.aggregate_array('clase_mb_i')).distinct()
                           .map(function(str){
                             return ee.Number.parse(str, 10);
                           })
                           .sort();
print('valores', valores);
var min = valores.get(0).getInfo();
var max = valores.get(-1).getInfo();
Map.addLayer(fills,
  {min:min, 
  max:max,
  palette: palette}, 
  'Polígonos estables INEGI', false);

// Stable areas
// Percentages in stable areas represent percentage of pixels that correspond to the LULC class of interest
// at the scale being observed in the map screen
Map.addLayer(stable,
  visLulc, 
  'stable map region' + region_name);

Export.image.toAsset({
  image: stable,
  description: stableName,
  assetId: sample_folder + stableName,
  scale: 30,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: region
});

                            
// var paleta = ee.Dictionary.fromLists(
//   ['3', '5', '9', '11', 
//   '15', '19', '21', '24', 
//   '25', '33', '34', '36', 
//   '45', '66', '88', '89'],
//   ['#9C0DBF', '#FF12A8', '#12FF9C', '#FF1290',
//   '#90FF12', '#FF1212', '#B50202', '#8F8F8F',
//   '#000000', '#152DCF', '#FFFFFF', '#1DDBE0',
//   '#E0E01D', '#E0B91D', '#289608', '#966708']);  