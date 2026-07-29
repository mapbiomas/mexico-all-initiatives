// Use the collected training samples to classify a preliminary map 
// Then, use the preliminary map to retrieve pixels that were the same class all the years (stable pixels)
// It can be used to improve and increase the training samples in the next step 

// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// Define you name
var name_x = 'jvsv'; 

// Define the region name (needs match with the featureCollection names defined in the previous section)
// 1  Noroeste
// 2  Centronorte
// 3  Noreste
// 4  Centrosur
// 5  Sureste
var region_name = 4;

// Define the subregion name
// 9	Grandes Planicies	
// 10	Desiertos de America del Norte
// 11	California Mediterranea
// 12	Elevaciones Semiaridas Meridionales
// 13	Sierras Templadas
// 14	Selvas Calido-Secas
// 15	Selvas Calido-Humedas
var subregion_name = 15; 

// ## Visualization years
var startYear = 1986;
var interYear1 = 2000;
var interYear2 = 2015;
var endYear = 2025;

// Define years to extract spectral signatures and build a spectral library 
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            
// Define the name of the stable map (stable pixels)
var stable_file_name_out = 'Stable_Map';
var stable_version_out = '1';   // define the version of the stable map 

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

// ## Load previous samples.
// Need to check available assets in project
// Define the folder in which samples were stored in the previous step 
var sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/';
var sample_file_name_in = 'trained_Samples_MEX_'; 

// Load trained Samples based in name patterns 
// Check for duplicates (will appear in buffer areas)
// !! Check file names just to read the ones that match the current subregion !!
// Tip: Order them according to subregion_name
// Select training samples by name
var trainedSamples = [];

// Read different assets according to the subregion being selected
if (subregion_name == 12){
  var ts1 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_12_AAP_v1');
  var ts2 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_12_jet_v2');
  var ts3 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_12_jpad_v3');
  var ts4 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_12_smvj_v1');
  var ts5 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_12_StephC_v3');
  
  trainedSamples = ts1
  .merge(ts2).merge(ts3).merge(ts4).merge(ts5);
} else if(subregion_name == 13){
  var ts6 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_dlrm_v4');
  var ts7 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_fjoc_v1');
  var ts8 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_jvsv_v3');
  var ts9 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_xanynemiga_v1');
  var ts10 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_irt_v3');
  var ts11 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_alequech_v1');
  var ts12 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_StephC_v3');
  var ts13 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_13_jet_v3');
  
  trainedSamples = ts6.merge(ts7).merge(ts8).merge(ts9).merge(ts10)
                      .merge(ts11).merge(ts12).merge(ts13);
}else if(subregion_name == 14){
  var ts14 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_14_jvsv_v3');
  var ts15 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_14_civr_v3');
  var ts16 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_14_xanynemiga_v1');
  var ts17 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_14_cm_v1');
 
  trainedSamples = ts14.merge(ts15).merge(ts16).merge(ts17);
  
}else if(subregion_name == 15){
  var ts18 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_15_cm_v3');
  var ts19 = ee.FeatureCollection(sample_folder+sample_file_name_in+region_name+'_15_xanynemiga_v1');
  
  trainedSamples = ts18.merge(ts19);
}

// All training samples
//print('trainedSamples size: ', trainedSamples.size());

// Remove features with same year and geometry
//trainedSamples = trainedSamples.distinct(['year','.geo']);

// Plot the centroids
Map.addLayer(trainedSamples, {color: 'red'}, 'All Samples Preview', false);
//print('trainedSamples size without duplicates: ', trainedSamples.size());

var commonClasses = 500,
    interClasses = 50,
    rareClasses = 20;
    
// Empirical balancing
var balance_samples = [
  [88,commonClasses],  
  [89,commonClasses],  
  [3,commonClasses], 
  [5,rareClasses],   
  [66,rareClasses],  
  [45,rareClasses],  
  [11,rareClasses],  
  [15,rareClasses],  
  [36,rareClasses],  
  [19,interClasses],
  [9,interClasses],
  [21,interClasses],
  [24,interClasses],
  [25,interClasses],
  [33,interClasses],
  [34,interClasses],
];

// Do not need to move anything else from here on -----
var collection_id = 1.0;

// adicionar aggrgate array para os anos 
// Define the country name 
var country_name = 'MEX';

// Clases
// Bosque_Tropical_humedo: 3
// * Manglar: 5
// Plantacion_forestal: 9
// Inundables: 11
// Pastizales_cultivados: 15
// Cultivos_anuales: 19
// * Mosaico_de_usos: 21
// * Area_urbana_y_construida: 24
// Areas_sin_vegetacion: 25 
// Rios_lagos_y_mares: 33
// * Glaciares: 34
// Cultivo_perenne: 36
// Sabanas_y_pastizales_naturales: 45
// Matorral: 66
// Bosque_Templado: 88
// Bosque_Tropical_seco: 89

print('Classes captured in '+endYear + ' region ' + region_name + ' subregion '+ subregion_name +':',
      trainedSamples.filter(ee.Filter.eq('year',endYear)).aggregate_array('class').distinct().sort());

//
print('Number of Samples for each class '+endYear + ':',
      trainedSamples.filter(ee.Filter.eq('year',endYear)).aggregate_histogram('class'));

// Read Landsat mosaics for Mexico 
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');

// Read the training regions
var buffkm = 5;
var region_training = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print('Regiones: ', region_training.aggregate_array('Region'));  

// Filter regions to get only the interest region  
var region = region_training.filter(ee.Filter.eq('Region', region_name));

// Plot interest region 
Map.addLayer(region, {transparency: 0.5}, 'Region Limit', false);

var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);

print('Subregiones en la región ' +  region_name + ': ', ecoregsN1.aggregate_array('cveint'));

ecoregsN1 = ecoregsN1.filter(ee.Filter.eq('cveint', subregion_name));

// Show on map
Map.addLayer(ecoregsN1, {transparency: 0.5}, 'subregión ' + subregion_name, false);

var areaExport = ee.Feature(region.first()).intersection(ee.Feature(ecoregsN1.first()));
Map.addLayer(areaExport, {transparency: 0.5}, 'Region intersection subregion Limit', true);

// Filter training samples to subregion
trainedSamples = trainedSamples.filterBounds(ecoregsN1);

Map.addLayer(trainedSamples, {color: 'red'}, 'Samples in region ' + region_name + 'subregion ' + subregion_name, true);
print('trainedSamples for region ' +region_name+ ' subregion '+subregion_name+' : ', trainedSamples.size());

// input propoerties for random forest
var inputProperties = [
      'red_median','green_stdDev','green_median','blue_median',
      'nir_median','swir1_median','swir2_median',
      'evi2_median_dry','evi2_median_wet','evi2_stdDev',
      'ndvi_median_dry','ndvi_median_wet','ndvi_stdDev',
      'ndwi_median_dry','ndwi_median_wet','ndwi_stdDev','slope'
    ];

// Plot Landsat mosaics for specific years
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), visLandsat1, 'Landsat ' + startYear +  ' ' + visLandsat1.bands);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), visLandsat2, 'Landsat ' + startYear +  ' ' + visLandsat2.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), visLandsat3, 'Landsat ' + startYear +  ' ' + visLandsat3.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear1), visLandsat1, 'Landsat ' + interYear1 + ' ' + visLandsat1.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear1), visLandsat2, 'Landsat ' + interYear1 + ' ' + visLandsat2.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear1), visLandsat3, 'Landsat ' + interYear1 + ' ' + visLandsat3.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear2), visLandsat1, 'Landsat ' + interYear2+ ' ' + visLandsat1.bands, false );
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear2), visLandsat2, 'Landsat ' + interYear2+ ' ' + visLandsat2.bands, false );
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear2), visLandsat3, 'Landsat ' + interYear2+ ' ' + visLandsat3.bands, false );
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), visLandsat1, 'Landsat ' + endYear + ' ' + visLandsat1.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), visLandsat2, 'Landsat ' + endYear + ' ' + visLandsat2.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), visLandsat3, 'Landsat ' + endYear + ' ' + visLandsat3.bands , false);

// Classificador RF
var classifier = ee.Classifier.smileRandomForest({numberOfTrees: 100,
                                                  seed:15});

// This palette is not updated                                                  
var palettes = require('users/mapbiomas/modules:Palettes.js');
var visLULC = {'min': 0,'max': 89,'palette': auxFuncs.palette};

print('classes', trainedSamples.aggregate_array('class').distinct());

// ----------
// SAFE SHUFFLE (correct “lookupIn list must not be empty” error)
// ----------
var shuffle = function (collection, seed) {
  return ee.FeatureCollection(ee.Algorithms.If(
    collection.size().gt(0),
    collection.randomColumn('random', seed || 1).sort('random', true),
    collection
  ));
};

// ----------
// Classification
// ----------
var classifiedList = [];

years.forEach(function (year) {
  var trainedSamples_year = trainedSamples.filter(ee.Filter.eq('year', year));
  var balanced_trainedSamples = ee.FeatureCollection([]);

  balance_samples.forEach(function (class_and_samples) {
    var classId = class_and_samples[0];
    var nLimit = class_and_samples[1];
    var sample = trainedSamples_year.filter(ee.Filter.eq('class', classId));
    sample = shuffle(sample, 2).limit(nLimit);
    balanced_trainedSamples = balanced_trainedSamples.merge(sample);
  });

  print('Number of balanced samples ' + year, balanced_trainedSamples.size());

  // Read the Landsat mosaic for the year [x]
  var Landsat_annual_mosaic = Land_collection.filter(ee.Filter.eq('year', year))
      .mosaic();

  classifier = classifier.train({
    features: balanced_trainedSamples, 
    classProperty: 'class', 
    inputProperties: inputProperties
    //inputProperties: Landsat_annual_mosaic.bandNames()
    
  });
  // See variables of importance
  //print(classifier.explain()) 
  
  var classification = Landsat_annual_mosaic
      .clip(region)
      .clip(ecoregsN1)
      .classify(classifier)
      .rename('classification_' + year);

  classifiedList.push(classification);
  Map.addLayer(classification, visLULC, 'LULC RF classification ' + year, false);
});

// ----------
// STABLE PIXELS
// ----------
var classifiedStack = ee.Image(classifiedList);

var calculateNumberOfClasses = function (image) {
  return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};
var nClasses = calculateNumberOfClasses(classifiedStack);

var stable = classifiedStack.select(0).multiply(nClasses.eq(1)).selfMask();
Map.addLayer(stable, visLULC, 'Stable', true);

stable = stable.rename('stable')
  .set('collection_id', collection_id)
  .set('version', stable_version_out)
  .set('territory', region_name);

// Export
var stableName = country_name + '_' + stable_file_name_out + '_' + region_name + '_' + subregion_name + '_' + name_x + '_v' + stable_version_out;
print(stableName);

Export.image.toAsset({
  image: stable,
  description: stableName,
  assetId: sample_folder + stableName,
  scale: 30,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: areaExport
});
