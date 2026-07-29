// Spatial filter
// Define probailities with spatial filter using a focal mean

// Import aux funcs
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// Define the territory name 
var country_name = 'MEX';

// Define the region name (needs match with the featureCollection names defined in the previous section)
var region_name = 4;

// Define youy name
var name_x = 'jvsv';

// Read classification regions
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(regions, "regiones");

// Filter only interest region
regions = regions.filterMetadata('Region', 'equals', region_name);

// List of years to be processed.
//Define years to process.
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Define the minimum number of connected pixels
var filter_size = 6;

var temporal_version_in = '1';
var spatial_version_out = '1';

/////////////////////////////

var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var input_path = class_folder + country_name + '_' + region_name + '_' +  name_x + '_gapfill_temporal_v' + temporal_version_in;
var input_prob_path = class_folder + country_name + '_' + region_name + '_' +  name_x + '_probability_gapfill_temporal_v' + temporal_version_in;

var spatial_file_name_out = 'gapfill_temporal_spatial';

var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var visLandsat = {"bands": ["swir1_median", "nir_median", "red_median"],"min": 0, "max": 5615, "gamma":1};

Map.addLayer(Land_collection.filter(ee.Filter.eq('year', 2024)).mosaic(), visLandsat, 'Landsat 2024');

// Load the palettes module for visualization
// var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define visualization parameters for the classification bands
var vis = {
    min: 0, 
    max: 89, 
    palette: auxFuncs.paleta,
    'format': 'png'
};

var visProb = {
    min: 0, 
    max: 1, 
    palette: auxFuncs.viridis,
    'format': 'png'
};

//var input_path = 'projects/mapbiomas-india/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/India_classification_vaibhavchugh_v1'

// Load the classification image and its probability image
var classification = ee.Image(input_path);
var probability = ee.Image(input_prob_path);
print(classification);
classification = classification.addBands(probability);

///*************************************************************
// Do not Change from these lines
////*************************************************************

// Import the palettes module
// var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define the palettes for visualization

// Add the classification image to the map
Map.addLayer(classification.select('classification_2024'), vis, 'Input 2024');


// create an empty container
var filtered = ee.Image([]);

// apply filter
years.forEach(function(year_i) {
        // compute the focal model
        var focal_mode = classification.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
        
        // Using focal mean to set probability of the pixels that are being substituted
        // using the spatial filters
        var focal_mean = classification.select(['probability_' + year_i])
                .unmask(0)
                .focal_mean({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
                
        // compute te number of connections
        var connections = classification.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});
        
        // get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));
        var to_maskProb = focal_mean.updateMask(connections.lte(filter_size));
        
        // apply filter
        var classification_i = classification.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 30);
        var probability_i = classification.select(['probability_' + year_i])
                .blend(to_maskProb)
                .reproject('EPSG:4326', null, 30);

        // stack into container
        filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)))
                           .addBands(probability_i.updateMask(probability_i.neq(0)));
        }
      );

// print filtered
Map.addLayer(filtered.select(['classification_2025']), vis, 'Filtered classification 2025');
Map.addLayer(filtered.select(['probability_2025']), visProb, 'Filtered probability 2025');


// Define output path name based on the naming pattern
var output_name =  country_name + '_' + region_name + '_' + name_x + '_gapfill_temporal_spatial_v' + spatial_version_out;
var otuput_prob_name = country_name + '_' + region_name + '_' + name_x + '_probability_gapfill_temporal_spatial_v' + spatial_version_out;

// Export the final classification image to an asset
Export.image.toAsset({
    'image': filtered.select('classification_.*'),
    'description': output_name,
    'assetId': class_folder+output_name,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification.geometry().bounds(),
    'scale': 30,
    'maxPixels': 1e13,
    overwrite:true
});

// Export probability image
Export.image.toAsset({
    'image': filtered.select('probability_.*'),
    'description': otuput_prob_name,
    'assetId': class_folder+otuput_prob_name,
    'pyramidingPolicy': {
        '.default': 'mean'
    },
    'region': classification.geometry().bounds(),
    'scale': 30,
    'maxPixels': 1e13,
    overwrite:true
});
