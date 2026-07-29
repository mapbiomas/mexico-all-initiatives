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

// Versión script 23/02/2026
// Collect and export Landsat samples (spectral signatures) for the defined LCLU classes
// Note the good pratices to collect samples 

// Note:
// Do not collect training data for cross classes (mangrove, urban and mosaic of uses)

// Description:
// Shows preprocessed images for the indicated years and the indicated composites
// so users can collect samples.
// Once finished samples must be exported as a task

// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// ## Variables for exporting samples
// Define your name
var name_x = 'jvsv';

// Define the version of the samples 
var sample_version_out = '1';                 

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
var subregion_name = 12; 

// ## Visualization years
var startYear = 1985;
var interYear = 2000;
var endYear = 2025;

// Define years to extract spectral signatures and build a spectral library 
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            
// False color composites definition
// See available bands in Console: Bandas disponibles en los mosaicos ->
// If bands are changed, possibly values min and max need to be adjusted
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
// NIR standard deviation
var visLandsat3 = {
  "bands": ["nir_stdDev"],
  "min": 40, "max": 2300, "gamma":1
  };
  
// Do not need to move anything else from here on -----
// Define the territory name 
var country_name = 'MEX';

// Define the output folder for the collectecd samples 
var sample_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/SAMPLES/';
// Define the name of the training samples  
var sample_file_name_out = 'trained_Samples';  

// Read classification regions
// Read regions with buffer
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print("Regiones: ", regions.aggregate_array('Region'));
Map.addLayer(regions, {}, 'regions', false);

var region = regions.filter(ee.Filter.eq('Region', region_name));

// Add subregions
// Filter subregions by region
var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);
                                
print('Subregiones en la región ' +  region_name + ': ', ecoregsN1.aggregate_array('cveint'));

ecoregsN1 = ecoregsN1.filter(ee.Filter.eq('cveint', subregion_name));

// Show on map
Map.addLayer(ecoregsN1, {}, 'subregión ' + subregion_name, false);

// Define Landsat mosaic
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');

// ## False composites parameters
print('Bandas disponibles en los mosaicos: ', auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear));

// Plot mosaics for first and last year
// First year
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), 
       visLandsat1, 
        'Landsat ' + startYear + ' '+visLandsat1.bands );
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), 
        visLandsat2, 
        'Landsat '  + startYear+  ' ' + visLandsat2.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, startYear), 
        visLandsat3, 
        'Landsat ' + startYear + ' ' + visLandsat3.bands , false);
        
// Intermediate year
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear), 
       visLandsat1, 
        'Landsat ' + interYear + ' ' + visLandsat1.bands, false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear), 
        visLandsat2, 
        'Landsat ' + interYear + ' ' +visLandsat2.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, interYear), 
        visLandsat3, 
        'Landsat ' + interYear + ' ' +visLandsat3.bands , false);

// Last year
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), 
        visLandsat1, 
        'Landsat ' + endYear + ' ' + visLandsat1.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), 
        visLandsat2, 
        'Landsat ' + endYear + ' ' + visLandsat2.bands , false);
Map.addLayer(auxFuncs.corteSubreg(Land_collection, ecoregsN1, region, endYear), 
         visLandsat3 , 
        'Landsat ' + endYear + ' ' + visLandsat3.bands , false);

// Add the region to the map
Map.addLayer(region, {}, 'region' + region_name , false);

// initialize a empty feature.collection to receive the collected samples 
var trainPolys = ee.FeatureCollection([]);

// Apply the merge into the receiver featureCollection for each collected class 
trainPolys = auxFuncs.safeMerge(trainPolys, Bosque_Templado, 88);
trainPolys = auxFuncs.safeMerge(trainPolys, Bosque_Tropical_seco, 89);
trainPolys = auxFuncs.safeMerge(trainPolys, Bosque_Tropical_humedo, 3);
trainPolys = auxFuncs.safeMerge(trainPolys, Manglar, 5);
trainPolys = auxFuncs.safeMerge(trainPolys, Area_urbana_y_construida, 24);
trainPolys = auxFuncs.safeMerge(trainPolys, Areas_sin_vegetacion, 25);     
trainPolys = auxFuncs.safeMerge(trainPolys, Matorral, 66);
trainPolys = auxFuncs.safeMerge(trainPolys, Sabanas_y_pastizales_naturales, 45);
trainPolys = auxFuncs.safeMerge(trainPolys, Inundables, 11);
trainPolys = auxFuncs.safeMerge(trainPolys, Pastizales_cultivados, 15);
trainPolys = auxFuncs.safeMerge(trainPolys, Cultivos_anuales, 19);
trainPolys = auxFuncs.safeMerge(trainPolys, Mosaico_de_usos, 21);
trainPolys = auxFuncs.safeMerge(trainPolys, Cultivo_perenne, 36);
trainPolys = auxFuncs.safeMerge(trainPolys, Plantacion_forestal, 9);
trainPolys = auxFuncs.safeMerge(trainPolys, Rios_lagos_y_mares, 33);
trainPolys = auxFuncs.safeMerge(trainPolys, Glaciares, 34);


// print collected classes in the console 
print ('Collected Classes; ',trainPolys.aggregate_array('class').distinct());

// transform the collected polygons into image (just processing formalities)
var Sampleimg = trainPolys.reduceToImage({properties: ['class'],reducer: ee.Reducer.first()}).select([0],['class']);

/* (exemplo visual com um único ano — mantido comentado)
var img_2024 = get_mosaic.getMosaic(2024, '2024-01-01', '2024-12-31', regions, territory_name, version);
var trainingSamples_demo = img_2024.addBands(Sampleimg).sampleRegions({
    'collection': trainPolys, 
    'scale': 30,
    'geometries': true
  });
print('Number of Pixels, for each class',trainingSamples_demo.aggregate_histogram('class'));
Map.addLayer(trainingSamples_demo.filter(ee.Filter.eq('class', 3)), {color: '#0ddf06'}, 'Forest_Samples', false);
*/

// Initialize a empty collection for the spectral library 
var trainedSamples_allyears = ee.FeatureCollection([]);

// For each year
years.forEach(
  function (year) {
    
    // Get the Landsat mosaic for the given year 
    var img_year = Land_collection.filter(ee.Filter.eq('year', year));
    
    // Collect the spectral information of the polygons 
    var trainedSamples = img_year.mosaic().sampleRegions({
        'collection': trainPolys, 
        'scale': 30,
        'geometries': true
      });
    trainedSamples = trainedSamples.filter(ee.Filter.notNull(['red_median']));
    
    // add year as a variable 
    trainedSamples = trainedSamples.map(function(f) {return f.set('year', year)});
    
    // add signatures to the spectral library 
    trainedSamples_allyears = trainedSamples_allyears.merge(trainedSamples);
  }
);


// Print into the console the number of samples collected for each year 
print('Number of samples for 2024:', trainedSamples_allyears.filter(ee.Filter.eq('year', 2024)).size());
print('10 samples:', trainedSamples_allyears.limit(10));

// Define exporting name 
var out_name = sample_file_name_out+'_'+country_name+'_'+region_name+'_'+ subregion_name+'_' + name_x + '_v'+sample_version_out;

// Export the training data to GEE asset.
Export.table.toAsset({
  // Agregué para cortar las training samples con las subregiones
  collection: trainedSamples_allyears.filterBounds(ecoregsN1), 
  description: out_name, 
  assetId: sample_folder+out_name,
  overwrite: true
});

// List of all the classes in geometry imports
var imports = [
  Bosque_Templado, Bosque_Tropical_seco, Bosque_Tropical_humedo, Manglar, Matorral,
  Sabanas_y_pastizales_naturales, Inundables, Pastizales_cultivados, Cultivo_perenne,
  Cultivos_anuales, Plantacion_forestal, Mosaico_de_usos, Area_urbana_y_construida, Areas_sin_vegetacion, 
  Rios_lagos_y_mares, Glaciares
];

// Create a list for the collection of all polygons
var centroidCollections = imports.map(auxFuncs.getCentroids);

// Combine centroid features in a single collection
var allCentroids = ee.FeatureCollection(centroidCollections).flatten();

// Plot the centroids
Map.addLayer(allCentroids, {color: 'red'}, 'Centroids');