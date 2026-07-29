var Bosque_Templado = /* color: #ff2d1c */ee.FeatureCollection([]),
    Bosque_Tropical_seco = /* color: #00ffff */ee.FeatureCollection([]),
    Bosque_Tropical_humedo = /* color: #d63000 */ee.FeatureCollection([]),
    Manglar = /* color: #98ff00 */ee.FeatureCollection([]),
    Matorral = /* color: #ffc82d */ee.FeatureCollection([]),
    Sabanas_y_pastizales_naturales = /* color: #00ffff */ee.FeatureCollection([]),
    Inundables = /* color: #bf04c2 */ee.FeatureCollection([]),
    Pastizales_cultivados = /* color: #ff0000 */ee.FeatureCollection([]),
    Cultivo_perenne = /* color: #d63000 */ee.FeatureCollection([]),
    Cultivos_anuales = /* color: #98ff00 */ee.FeatureCollection([]),
    Plantacion_forestal = /* color: #0b4a8b */ee.FeatureCollection([]),
    Mosaico_de_usos = /* color: #ffc82d */ee.FeatureCollection([]),
    Area_urbana_y_construida = /* color: #d63000 */ee.FeatureCollection([]),
    Areas_sin_vegetacion = /* color: #98ff00 */ee.FeatureCollection([]),
    Rios_lagos_y_mares = /* color: #d63000 */ee.FeatureCollection([]),
    Glaciares = /* color: #d63000 */ee.FeatureCollection([]);

    // !! To perform final classification with complementary samples, change import polygons
// uncomment lines 367 - 376 and export task //

// Ask for copy/paste complementary samples from Imports
// Import and use to export final classification

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
var interestYear = 2025;

//Define region to process.
/*
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            */
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

var visProb = {min:0, max:1, 
  palette: auxFuncs.viridis};
  
// Input properties for random forest
// If only these are used, we can simplify the mosaic
var inputProperties = [
      'red_median','green_median','blue_median',
      'nir_median','swir1_median','swir2_median',
      'evi2_median_dry','evi2_median_wet','evi2_stdDev',
      'ndvi_median_dry','ndvi_median_wet','ndvi_stdDev',
      'ndwi_median_dry','ndwi_median_wet','ndwi_stdDev',
      'slope'
    ];

// Balance de acuerdo con análisis regiones e INEGI.
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

// Misma distribución que script 4.ExportTrainedStable_Subregion
// Caculado aprox 12000 por region / 4 subregiones = 3000
// Poner mín número de puntos 0.001 * 3000 = 3 (por si hubiera)
var total = 3000;
var nSamplesPerClass = [];
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

var classPoints = nSamplesPerClass.map(function (item) {return item.n_samples});

print('classPoints',classPoints);

// Do not need to move anything else from here on -----
// Define the name of the country 
var country_name = 'MEX';

// Define the folder in which samples are placed 
var sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/';
var stable_samples_name_in = 'Stable_Sample';   // Define the name of the samples collection 
var stable_samples_version_in = '1';            // Define the version of the samples collection 

// Define name to export complementary samples
var compl_samples_name_out = 'Complementary_Sample';   // Define the name of the samples collection 
var compl_samples_version_out = '1';  

// Define the folder to export classification 
var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var classification_name_out = 'classification'; // Define the name of the classification collection 
var probability_name_out = 'probability'; // Define the name of the probability collection 
var classification_version_out = '1';           // Define the version of the classification 

// Read classification regions
var buffkm = 5;
var region_training = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(region_training.aggregate_array('Region'));  // Print region names 

// Read Landsat mosaics 
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');

// Read trained samples (spectral signatures)
var StabletrainedSamples_name = sample_folder+stable_samples_name_in+'_'+country_name+'_'+region_name+ '_' + subregion_name+ '_' + name_x + '_v'+stable_samples_version_in;
var StabletrainedSamples = ee.FeatureCollection(StabletrainedSamples_name);
// Classes arrayFlatten for multiprobability image
var classes = StabletrainedSamples.aggregate_array('class')
                                  .distinct()
                                  .map(function(entry){
                                    return ee.Number.parse(entry, 10);
                                  })
                                  .sort()
                                  .map(function(entry){
                                    return ee.String(entry);
                                  });
print('Stable trained Samples', classes);
print('Stable trained Samples size:', StabletrainedSamples.size());

// Select only the region of interest 
var region = region_training.filter(ee.Filter.eq('Region', region_name));
Map.addLayer(region, {},'region ' + region_name, false);  // Add region to the map 

var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);
                                
print('Subregiones en la región ' +  region_name + ': ', ecoregsN1.aggregate_array('cveint'));

ecoregsN1 = ecoregsN1.filter(ee.Filter.eq('cveint', subregion_name));
ecoregsN1 = ee.Feature(ecoregsN1.first()).intersection(ee.Feature(region.first()), 30).geometry();
Map.addLayer(ecoregsN1, {},'region ' + region_name + ' subregion ' + subregion_name, false);

// Plot Landsat mosaics for first and last year 
Map.addLayer(auxFuncs.corteSubreg(Land_collection, region, ecoregsN1,startYear), visLandsat1, 'Landsat ' + startYear+' ' + visLandsat1.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, region, ecoregsN1,endYear), visLandsat1, 'Landsat ' + endYear+' ' + visLandsat1.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, region, ecoregsN1,interestYear), visLandsat1, 'Landsat ' + interestYear+' ' + visLandsat1.bands, true);

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

// class_id, class_name, number_of_samples
/*
Complementary_samples = Complementary_samples
  .merge(generatePoints( 3, Bosque_Tropical_humedo, classPoints[0]))
  .merge(generatePoints( 5, Manglar, classPoints[1]))
  .merge(generatePoints( 9, Plantacion_forestal, classPoints[2]))
  .merge(generatePoints( 11, Inundables, classPoints[3]))
  .merge(generatePoints( 15, Pastizales_cultivados, classPoints[4]))
  .merge(generatePoints( 19, Cultivos_anuales, classPoints[5]))
  .merge(generatePoints( 21, Mosaico_de_usos, classPoints[6]))
  .merge(generatePoints( 24, Area_urbana_y_construida, classPoints[7]))
  .merge(generatePoints( 25, Areas_sin_vegetacion, classPoints[8]))
  .merge(generatePoints( 33, Rios_lagos_y_mares, classPoints[9]))
  .merge(generatePoints( 34, Glaciares, classPoints[10]))
  .merge(generatePoints( 45, Sabanas_y_pastizales_naturales, classPoints[11]))
  .merge(generatePoints( 66, Matorral, classPoints[12]))
  .merge(generatePoints( 36, Cultivo_perenne, classPoints[13]))
  .merge(generatePoints( 88, Bosque_Templado, classPoints[14]))
  .merge(generatePoints( 89, Bosque_Tropical_seco, classPoints[15]))
  // Filtrar solo puntos dentro de la subregion
  .filterBounds(ecoregsN1);
  */

print('Complementary Samples for each class', Complementary_samples.aggregate_histogram('class'));

// Print the number of complementary samples 
print('Complementary_samples size', Complementary_samples.size());

// To export complementary samples
var complementarySamplesReduce = ee.FeatureCollection(years.map(function(year){
  
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
    return trainedComplementary_samples.map(function(feat){
      return ee.Feature(feat).set('year', ee.Number(year).int());
    });
})).flatten();

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
    
    // var trainedComplementary_samples = Landsat_annual_mosaic.reduceRegions({
    //     collection: Complementary_samples, 
    //     reducer: ee.Reducer.first(), 
    //     scale: 30,
    //   });
    // trainedComplementary_samples = trainedComplementary_samples.filter(ee.Filter.notNull(['red_median']));
  
  // Merge the old samples (from the stable maps) with the complementary samples 
   // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  // Using all samples from all years. Tried to filter only samples from the current years
  // but there are no samples for years 1988 and 2004, thus, cannot do completely independent
  // classifications. Room for improving here.
  // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  var totalTrainedSamples = StabletrainedSamples.merge(
                                // Complementary samples filter by year
                                complementarySamplesReduce.filter(ee.Filter.eq('year', ee.Number(year))));
  
  
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
  var classification = Landsat_annual_mosaic.classify(classifier)
                                            .rename('classification');
  
  // Maximum probability class image using the same classifier
  classifier = classifier.setOutputMode('MULTIPROBABILITY');
  
  // For multiprobability use arrayFlatten([[list of classes]])
  var classificationProb = Landsat_annual_mosaic.classify(classifier)
                                                // Get max prob to easily use it to mosaic
                                                .arrayReduce(ee.Reducer.max(),[0])
                                                .arrayFlatten([['probability']]);
  
  // Add classification to the map 
  // Map.addLayer(classification, visLulc,'LULC RF classification ' + year, false);
  return classification.addBands(classificationProb);
});

var yearsString = years.map(function(year){
                                      return ee.String('classification_').cat(ee.String(ee.Number(year).round().int()));
                                    });
var yearsStringProb = years.map(function(year){
                                      return ee.String('probability_').cat(ee.String(ee.Number(year).round().int()));
                                    });
                                  
var classified84a25Class = ee.ImageCollection.fromImages(classified84a25).select('classification').toBands()
                                    .rename(yearsString)
                                    // Avoid exporting the bounding box of the polygon and mask pixels outside poly
                                    .clip(ecoregsN1);

var classified84a25Prob = ee.ImageCollection.fromImages(classified84a25).select('probability').toBands()
                                    .rename(yearsStringProb)
                                    // Avoid exporting the bounding box of the polygon and mask pixels outside poly
                                    .clip(ecoregsN1);

// Check the classification output 
print('classified 1984 to 25',classified84a25);

Map.addLayer(classified84a25Class.select('classification_'+interestYear), 
  visLulc, 'classification_'+interestYear);
Map.addLayer(classified84a25Prob.select('probability_'+interestYear), 
  visProb, 'probability_'+interestYear);
Map.addLayer(ecoregsN1, 
  {}, 'ecoregsN1');
  
// Build the name of the classification output 
var class_name = country_name + '_' + classification_name_out + '_' + region_name+ '_' +subregion_name+ '_' + name_x + '_v' + classification_version_out ;
var class_prob_name = country_name + '_' + probability_name_out + '_' + region_name+ '_' +subregion_name+ '_' + name_x + '_v' + classification_version_out ;

// Export classification as a GEE asset 

Export.image.toAsset({
    "image": classified84a25Class,
    "description": class_name,
    "assetId": class_folder + class_name,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mode'},
    "maxPixels": 1e13,
    "region": ecoregsN1,
    overwrite: true
}); 

Export.image.toAsset({
    "image": classified84a25Prob,
    "description": class_prob_name,
    "assetId": class_folder + class_prob_name,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mean'},
    "maxPixels": 1e13,
    "region": ecoregsN1,
    overwrite: true
}); 

var compl_samples_name_out = 'Complementary_Sample';   // Define the name of the samples collection 
var compl_samples_version_out = '1';  

var compl_samples_name = compl_samples_name_out + '_' +country_name + '_'+region_name+'_'+subregion_name+'_'+ name_x + '_' +compl_samples_version_out;

Export.table.toAsset({
    "collection": complementarySamplesReduce,
    "description": compl_samples_name,
    "assetId": sample_folder + compl_samples_name,
    overwrite: true
}); 