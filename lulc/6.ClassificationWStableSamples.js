// !! Task is too heavy to run on-the-fly, 
// thus, we now run the task without auxiliary samples and then read this image as asset. 
// 6.1 ClassView contains script to visualize classifications !!

// Perform a classification with the stable samples
// inspect and collect new auxiliary samples

// Load the palettes module for visualization
// var palettes = require('users/mapbiomas/modules:Palettes.js');
// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// Define you name
var name_x = 'jvsv';

// Define the name of the region 
var region_name = 4;
var subregion_name = 15;

// ## Visualization region
var startYear = 1985;
var endYear = 2025;
var interestYear = 2000;

// Use years as a server-side object to map classification process over years.            
var years = ee.List.sequence(startYear, endYear, 1);
            
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

// Define visualization parameters for the classification bands
// LULC palette
var visLulc = {min: 0, 
  max: 89, 
  palette: auxFuncs.paleta,
  opacity: 1
};

// Input properties for random forest
var inputProperties = [
      'red_median','green_median','blue_median',
      'nir_median','swir1_median','swir2_median',
      'evi2_median_dry','evi2_median_wet','evi2_stdDev',
      'ndvi_median_dry','ndvi_median_wet','ndvi_stdDev',
      'ndwi_median_dry','ndwi_median_wet','ndwi_stdDev',
      'slope'
    ];
    
// Do not need to move anything else from here on -----
// Define the name of the country 
var country_name = 'MEX';

// Define the folder in which samples are placed 
var sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/';
var stable_samples_name_in = 'Stable_Sample';   // Define the name of the samples collection 
var stable_samples_version_in = '1';            // Define the version of the samples collection 

// Stable map
var stable_file_name_out = 'Stable_Map',
name_x = 'jvsv',
stable_version_out = 1,
 stableName  = country_name + '_' + stable_file_name_out + '_' + region_name + '_' + subregion_name+ '_'  + name_x + '_v' + stable_version_out;
    
// Define the folder to export classification 
var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var classification_name_out = 'classification'; // Define the name of the classification collection 
var classification_version_out = '1';           // Define the version of the classification 

// Read classification regions
var buffkm = 5;
var region_training = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(region_training.aggregate_array('Region'));  // Print region names 

Map.addLayer(region_training, {},'region_training ', false);  // Add region to the map 


// Read Landsat mosaics 
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');

// Define the function to convert the drawn polygons into new samples
var generatePoints = function(classValue, polygons, nPoints){
  var points = ee.FeatureCollection.randomPoints(polygons, nPoints);
  points = points.map(function(point){
    return point.set('class', classValue);
  });
  return points;
};

// Initialize the collection of complementary samples 
var Complementary_samples = ee.FeatureCollection([]);

// Do not add complementary samples in this step, so the classifications are created
// only from stable samples
// class_id, class_name, number_of_samples
// Complementary_samples = Complementary_samples
//   .merge(generatePoints( 88, Bosque_Templado, 500))
//   .merge(generatePoints( 89, Bosque_Tropical_seco, 50))
//   .merge(generatePoints( 3, Bosque_Tropical_humedo, 50))
//   .merge(generatePoints( 5, Manglar, 50))
//   .merge(generatePoints( 66, Matorral, 50))
//   .merge(generatePoints( 45, Sabanas_y_pastizales_naturales, 50))
//   .merge(generatePoints( 11, Inundables, 50))
//   .merge(generatePoints( 15, Pastizales_cultivados, 50))
//   .merge(generatePoints( 36, Cultivo_perenne, 50))
//   .merge(generatePoints( 19, Cultivos_anuales, 50))
//   .merge(generatePoints( 9, Plantacion_forestal, 50))
//   .merge(generatePoints( 21, Mosaico_de_usos, 50))
//   .merge(generatePoints( 24, Area_urbana_y_construida, 500))
//   .merge(generatePoints( 25, Areas_sin_vegetacion, 50))
//   .merge(generatePoints( 33, Rios_lagos_y_mares, 50))
//   .merge(generatePoints( 34, Glaciares, 50))

// Print the number of complementary samples 
print('Complementary_samples size', Complementary_samples.size());


// Read trained samples (spectral signatures)
var StabletrainedSamples_name = sample_folder+stable_samples_name_in+'_'+country_name+'_'+region_name+ '_' + subregion_name+ '_' + name_x + '_v'+stable_samples_version_in;
var StabletrainedSamples = ee.FeatureCollection(StabletrainedSamples_name);
print('StabletrainedSamples', StabletrainedSamples.limit(10));

// Select only the region of interest 
var region = region_training.filter(ee.Filter.eq('Region', region_name));
Map.addLayer(region, {},'region ' + region_name, false);  // Add region to the map 

var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);
                                
print('Subregiones en la región ' +  region_name + ': ', ecoregsN1.aggregate_array('cveint'));

ecoregsN1 = ecoregsN1.filter(ee.Filter.eq('cveint', subregion_name));
ecoregsN1 = ee.Feature(ecoregsN1.first()).intersection(ee.Feature(region.first()), 30).geometry();
Map.addLayer(ecoregsN1, {},'region ' + region_name + 'subregion' + subregion_name, false);

// Plot Landsat mosaics for first and last year 
Map.addLayer(auxFuncs.corteSubreg(Land_collection, region, ecoregsN1,startYear), visLandsat1, 'Landsat ' + startYear+' ' + visLandsat1.bands);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, region, ecoregsN1,endYear), visLandsat1, 'Landsat ' + endYear+' ' + visLandsat1.bands);


// For each year 
// Client side loop
/*
for (var i_year=0;i_year<years.length; i_year++){
  var year = years[i_year];
    
    // Read the landsat mosaic for the year 
    var Landsat_annual_mosaic = Land_collection.filter(ee.Filter.eq('year', year)).mosaic().clip(region);
    
    // Collect the spectral information of the complementary samples
    var trainedComplementary_samples = Landsat_annual_mosaic.reduceRegions({
        'collection': Complementary_samples, 
        'reducer': ee.Reducer.first(), 
        'scale': 30,
      });
    trainedComplementary_samples = trainedComplementary_samples.filter(ee.Filter.notNull(['red_median']));
  
  // Merge the old samples (from the stable maps) with the complementary samples 
  var totalTrainedSamples = StabletrainedSamples.merge(trainedComplementary_samples);

  // Train the random forest classifier
  classifier = classifier.train({
    'features': totalTrainedSamples, 
    'classProperty': 'class', 
    'inputProperties': inputProperties
  });
  
  // Print variables importance 
  print(year, classifier.explain());
  
  // Run the Random Forest classifier
  var classification = Landsat_annual_mosaic.classify(classifier);
  
  // Add classification to the map 
  Map.addLayer(classification, visLulc,'LULC RF classification ' + year, false);
  
  // If is the first year, create the collection to receive classification
  if (i_year === 0){ 
    var classified00a24 = classification.rename('classification_'+ year);
  } else {
    // If is not the first year, stack other region into the collection 
    classified00a24 = classified00a24.addBands(classification.rename('classification_'+ year));
  }
}
*/

// Server side loop
var classified84a25 = years.map(function(year){
    
    // Read the landsat mosaic for the year 
    var Landsat_annual_mosaic = Land_collection.filter(ee.Filter.eq('year', ee.Number(year)))
                                               .mosaic();
    
    // Collect the spectral information of the complementary samples
    
    var trainedComplementary_samples = Landsat_annual_mosaic.reduceRegions({
        collection: Complementary_samples, 
        reducer: ee.Reducer.first(), 
        scale: 30,
      });
    trainedComplementary_samples = trainedComplementary_samples.filter(ee.Filter.notNull(['red_median']));
  
  // Merge the old samples (from the stable maps) with the complementary samples 
  var totalTrainedSamples = StabletrainedSamples.merge(trainedComplementary_samples);
  
  // Set up the Random Forest classifier
  var classifier = ee.Classifier.smileRandomForest({
      numberOfTrees: 100,
      seed:11
  });

  // Train the random forest classifier
  classifier = classifier.train({
    features: totalTrainedSamples, 
    classProperty: 'class', 
    inputProperties: inputProperties
  });
  
  // Print variables importance 
  //print(year, classifier.explain());
  
  // Run the Random Forest classifier
  var classification = Landsat_annual_mosaic.classify(classifier);
  
  // Add classification to the map 
  // Map.addLayer(classification, visLulc,'LULC RF classification ' + year, false);
  return classification;
});

var yearsString = years.map(function(year){
                                      return ee.String('classification_').cat(ee.String(ee.Number(year).round().int()));
                                    });
                                  
classified84a25 = ee.ImageCollection.fromImages(classified84a25).toBands()
                                    .rename(yearsString)
                                    // Avoid exporting the bounding box of the polygon and mask pixels outside poly
                                    .clip(ecoregsN1);

// Check the classification output 
print('classified 1984 to 25',classified84a25);

Map.addLayer(classified84a25.select('classification_'+interestYear), 
  visLulc, 'classification_'+interestYear);

// Build the name of the classification output 
var class_name = country_name + '_' + classification_name_out + '_' + region_name+ '_' +subregion_name+ '_' + name_x + '_v' + classification_version_out ;
print('export asset', class_folder + class_name);

// Export classification as a GEE asset 
Export.image.toAsset({
    "image": classified84a25,
    "description": class_name,
    "assetId": class_folder + class_name,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mode'},
    "maxPixels": 1e13,
    "region": ecoregsN1,
    overwrite: true
}); 
