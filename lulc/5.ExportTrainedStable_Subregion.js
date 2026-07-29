/// Use the stable pixels from the previous step to get new training samples automatically 
// Load palettes
// var palettes = require('users/mapbiomas/modules:Palettes.js');

// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// Define your name 
var name_x = 'jvsv';

// Define the region name 
var region_name = 4;

// Define the subregion name
// 9	Grandes Planicies	
// 10	Desiertos de America del Norte
// 11	California Mediterranea
// 12	Elevaciones Semiaridas Meridionales
// 13	Sierras Templadas
// 14	Selvas Calido-Secas
// 15	Selvas Calido-Humedas
var subregion_name = 12;

// Define the country name
var country_name = 'MEX';

// ## Visualization years
var startYear = 1985;
var endYear = 2025;

//Define years to process.
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            
// ## False composites parameters
// SWIR1 - NIR - R
var visLandsat1 = {
  "bands": ["swir1_median", "nir_median", "red_median"],
  "min": 100, "max": 4000, "gamma":1
  };
// NIR - R - G
var visLandsat2 = {
  "bands": ["nir_median", "red_median", "green_median"],
  "min": 100, "max": 4000, "gamma":1
  };
var visLandsat3 = {
  "bands": ["nir_stdDev"],
  "min": 40, "max": 2300, "gamma":1
  };

// LULC palette
var visLulc = {min: 0, 
  max: 89, 
  palette: auxFuncs.paleta,
  opacity: 1
};

// Do not need to move anything else from here on -----
// Define the folder in which stable map was stored 
var sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/';
var stable_file_name_in = 'Stable_Map'; // Define the name of the stable pixels map
var stable_version_in = '1';            // Define the version of the stable pixels map

// Define a filename to store the new samples that will be get from stable pixels 
var stable_samples_name_out = 'Stable_Sample';
var stable_samples_version_out = '1';

//!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// ====== SOMENTE AS CLASSES USADAS NO PASSO ANTERIOR ======

// Balance samples according to proportions corresponding to each region and subregion
// using INEGI LULC layer.
// https://drive.google.com/drive/u/1/folders/1M_zdKgcqG6_tQKY4JtC9BK4Y27vzcbhJ

// Bosque_Tropical_humedo: 3
// Manglar: 5
// Plantacion_forestal: 9
// Inundables: 11
// Pastizales_cultivados: 15
// Cultivos_anuales: 19
// Mosaico_de_usos: 21
// Area_urbana_y_construida: 24
// Areas_sin_vegetacion: 25 
// Rios_lagos_y_mares: 33
// Glaciares: 34
// Cultivo_perenne: 36
// Sabanas_y_pastizales_naturales: 45
// Matorral: 66
// Bosque_Templado: 88
// Bosque_Tropical_seco: 89

// Using a max of 3000 points by subregion
// Minimum number of points 0.001 * 3000 = 3 (if that is the case)
var total = 3000;
var nSamplesPerClass = [];

// Subregion balance
if (subregion_name == 12){
  nSamplesPerClass = [
    { 'class_id': 3, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Bosque_Tropical_humedo
    { 'class_id': 5,  'n_samples': parseFloat((total * 0.001).toFixed(0)) },// Manglar
    { 'class_id': 9, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Plantacion_forestal
    { 'class_id': 11, 'n_samples': parseFloat((total * 0.002).toFixed(0)) }, // Inundables
    { 'class_id': 15, 'n_samples': parseFloat((total * 0.07).toFixed(0)) },  // Pastizales_cultivados
    { 'class_id': 19, 'n_samples': parseFloat((total * 0.56).toFixed(0)) }, // Cultivos_anuales
    { 'class_id': 21, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Mosaico_de_usos
    { 'class_id': 24, 'n_samples': parseFloat((total * 0.04).toFixed(0)) }, // Area_urbana_y_construida
    { 'class_id': 25, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Areas_sin_vegetacion
    { 'class_id': 33, 'n_samples': parseFloat((total * 0.04).toFixed(0)) }, // Rios_lagos_y_mares
    { 'class_id': 34, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Glaciares
    { 'class_id': 36, 'n_samples': parseFloat((total * 0.005).toFixed(0)) }, // Cultivo_perenne
    { 'class_id': 45, 'n_samples': parseFloat((total * 0.046).toFixed(0)) },  // Sabanas_y_pastizales_naturales
    { 'class_id': 66, 'n_samples': parseFloat((total * 0.049).toFixed(0)) }, // Matorral
    { 'class_id': 88,  'n_samples': parseFloat((total * 0.06).toFixed(0)) }, // Bosque_Templado
    { 'class_id': 89,  'n_samples': parseFloat((total * 0.12).toFixed(0)) }, // Bosque_Tropical_seco
  ];
} else if(subregion_name == 13){
  nSamplesPerClass = [
    { 'class_id': 3, 'n_samples': parseFloat((total * 0.01).toFixed(0)) }, // Bosque_Tropical_humedo
    { 'class_id': 5,  'n_samples': parseFloat((total * 0.001).toFixed(0)) },// Manglar
    { 'class_id': 9, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Plantacion_forestal
    { 'class_id': 11, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Inundables
    { 'class_id': 15, 'n_samples': parseFloat((total * 0.07).toFixed(0)) },  // Pastizales_cultivados
    { 'class_id': 19, 'n_samples': parseFloat((total * 0.23).toFixed(0)) }, // Cultivos_anuales
    { 'class_id': 21, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Mosaico_de_usos
    { 'class_id': 24, 'n_samples': parseFloat((total * 0.002).toFixed(0)) }, // Area_urbana_y_construida
    { 'class_id': 25, 'n_samples': parseFloat((total * 0.003).toFixed(0)) }, // Areas_sin_vegetacion
    { 'class_id': 33, 'n_samples': parseFloat((total * 0.003).toFixed(0)) }, // Rios_lagos_y_mares
    { 'class_id': 34, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Glaciares
    { 'class_id': 36, 'n_samples': parseFloat((total * 0.03).toFixed(0)) }, // Cultivo_perenne
    { 'class_id': 45, 'n_samples': parseFloat((total * 0.004).toFixed(0)) },  // Sabanas_y_pastizales_naturales
    { 'class_id': 66, 'n_samples': parseFloat((total * 0.008).toFixed(0)) }, // Matorral
    { 'class_id': 88,  'n_samples': parseFloat((total * 0.54).toFixed(0)) }, // Bosque_Templado
    { 'class_id': 89,  'n_samples': parseFloat((total * 0.07).toFixed(0)) }, // Bosque_Tropical_seco
  ];
}else if(subregion_name == 14){
   nSamplesPerClass = [
    { 'class_id': 3, 'n_samples': parseFloat((total * 0.01).toFixed(0)) }, // Bosque_Tropical_humedo
    { 'class_id': 5,  'n_samples': parseFloat((total * 0.001).toFixed(0)) },// Manglar
    { 'class_id': 9, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Plantacion_forestal
    { 'class_id': 11, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Inundables
    { 'class_id': 15, 'n_samples': parseFloat((total * 0.14).toFixed(0)) },  // Pastizales_cultivados
    { 'class_id': 19, 'n_samples': parseFloat((total * 0.20).toFixed(0)) }, // Cultivos_anuales
    { 'class_id': 21, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Mosaico_de_usos
    { 'class_id': 24, 'n_samples': parseFloat((total * 0.02).toFixed(0)) }, // Area_urbana_y_construida
    { 'class_id': 25, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Areas_sin_vegetacion
    { 'class_id': 33, 'n_samples': parseFloat((total * 0.01).toFixed(0)) }, // Rios_lagos_y_mares
    { 'class_id': 34, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Glaciares
    { 'class_id': 36, 'n_samples': parseFloat((total * 0.03).toFixed(0)) }, // Cultivo_perenne
    { 'class_id': 45, 'n_samples': parseFloat((total * 0.002).toFixed(0)) },  // Sabanas_y_pastizales_naturales
    { 'class_id': 66, 'n_samples': parseFloat((total * 0.02).toFixed(0)) }, // Matorral
    { 'class_id': 88,  'n_samples': parseFloat((total * 0.10).toFixed(0)) }, // Bosque_Templado
    { 'class_id': 89,  'n_samples': parseFloat((total * 0.46).toFixed(0)) }, // Bosque_Tropical_seco
  ];
}else if(subregion_name == 15){
  nSamplesPerClass = [
    { 'class_id': 3, 'n_samples': parseFloat((total * 0.32).toFixed(0)) }, // Bosque_Tropical_humedo
    { 'class_id': 5,  'n_samples': parseFloat((total * 0.001).toFixed(0)) },// Manglar
    { 'class_id': 9, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Plantacion_forestal
    { 'class_id': 11, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Inundables
    { 'class_id': 15, 'n_samples': parseFloat((total * 0.15).toFixed(0)) },  // Pastizales_cultivados
    { 'class_id': 19, 'n_samples': parseFloat((total * 0.10).toFixed(0)) }, // Cultivos_anuales
    { 'class_id': 21, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Mosaico_de_usos
    { 'class_id': 24, 'n_samples': parseFloat((total * 0.02).toFixed(0)) }, // Area_urbana_y_construida
    { 'class_id': 25, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Areas_sin_vegetacion
    { 'class_id': 33, 'n_samples': parseFloat((total * 0.036).toFixed(0)) }, // Rios_lagos_y_mares
    { 'class_id': 34, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Glaciares
    { 'class_id': 36, 'n_samples': parseFloat((total * 0.16).toFixed(0)) }, // Cultivo_perenne
    { 'class_id': 45, 'n_samples': parseFloat((total * 0.006).toFixed(0)) },  // Sabanas_y_pastizales_naturales
    { 'class_id': 66, 'n_samples': parseFloat((total * 0.001).toFixed(0)) }, // Matorral
    { 'class_id': 88,  'n_samples': parseFloat((total * 0.05).toFixed(0)) }, // Bosque_Templado
    { 'class_id': 89,  'n_samples': parseFloat((total * 0.15).toFixed(0)) }, // Bosque_Tropical_seco
  ];
}

// Load Landsat mosaics 
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');

// Import the classification regions 
var buffkm = 5;
var region_training = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(region_training.aggregate_array('Region'));

// Filter only the region of interest 
var region = region_training.filter(ee.Filter.eq('Region', region_name));
Map.addLayer(region,{},'Region Limit', false);  // Add region to the map 

var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);
                                
print('Subregiones en la región ' +  region_name + ': ', ecoregsN1.aggregate_array('cveint'));

ecoregsN1 = ecoregsN1.filter(ee.Filter.eq('cveint', subregion_name));
ecoregsN1 = ee.Feature(ecoregsN1.first()).intersection(ee.Feature(region.first()), 30).geometry();
Map.addLayer(ecoregsN1,{},'Subregion Limit', false);  // Add subregion to the map 

// Plot first and last years of Landsat mosaic into the map 
Map.addLayer(auxFuncs.corteReg(Land_collection, region, startYear), visLandsat1, 'Landsat ' + startYear +' ' + visLandsat1.bands);
Map.addLayer(auxFuncs.corteReg(Land_collection, region, endYear), visLandsat1, 'Landsat ' + endYear +' ' + visLandsat1.bands);

// Define stable pixels map name 
var stableName = sample_folder + country_name + '_' + stable_file_name_in + '_' + region_name+ '_'+ subregion_name+ '_'+name_x + '_v' + stable_version_in;
print('stableName',country_name + '_' + stable_file_name_in + '_' + region_name+ '_'+ subregion_name+ '_'+name_x + '_v' + stable_version_in);

// Read stable pixels map 
var stable = ee.Image(stableName).rename('class');
Map.addLayer(stable, visLulc,'Stable_region'+region_name+'_subregion' + subregion_name , true);

// Prepare lists for the stratified sample
var classValues = nSamplesPerClass.map(function (item) {return item.class_id});
var classPoints = nSamplesPerClass.map(function (item) {return item.n_samples});

// Stratified sample
var stableSamples = stable.stratifiedSample({
  'numPoints': 0,
  'classBand': 'class',
  'region': ecoregsN1,
  'classValues': classValues,
  'classPoints': classPoints,
  'scale': 30,
  'seed': 1,
  'geometries': true
});

print('Samples for each class', stableSamples.aggregate_histogram('class'));

// tranied samples for all years
var trainedSamples_allyears = ee.FeatureCollection([]);

// For each year extract the spectral signature for each class
years.forEach(function (year) {
   var img_year = Land_collection.filter(ee.Filter.eq('year', year));
    print(year, img_year.mosaic())

  // Extrair estatísticas espectrais (pixel onde há amostra)
  var trainedSamples = img_year.mosaic().reduceRegions({
    'collection': stableSamples, 
    'reducer': ee.Reducer.first(), 
    'scale': 30
  }).filter(ee.Filter.notNull(['red_median']));

  // Set year
  trainedSamples = trainedSamples.map(function(f) { return f.set('year', year); });

  // Merge trained samples
  trainedSamples_allyears = trainedSamples_allyears.merge(trainedSamples);
});

// Output name
var out_name = stable_samples_name_out+'_'+country_name+'_'+region_name+ '_'+ subregion_name+ '_'+ name_x + '_v'+stable_samples_version_out;

print('trainedSamples_allyears size', trainedSamples_allyears.size());
print('trainedSamples_allyears overview', trainedSamples_allyears.limit(10));

// Exportar para Asset
Export.table.toAsset({
  collection: trainedSamples_allyears, 
  description: out_name, 
  assetId: sample_folder + out_name,
  overwrite: true
});