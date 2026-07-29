// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// Define the territory name 
var country_name = 'MEX';

// Define the region name (needs match with the featureCollection names defined in the previous section)
var region_name = 4;

// Define youy name
var name_x = 'jvsv';

var yearInterest = 2025;

//Do not need to change anything from here on---------

// Read classification regions
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(regions, "regiones");

// Filter only interest region
regions = regions.filterMetadata('Region', 'equals', region_name);
Map.addLayer(regions, {}, 'regiones' , false);

var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff');
Map.addLayer(ecoregsN1, {}, 'subregiones' , false);


//Define years to process.
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];

var class_version_in = '1';
var gap_version_out = '1';

var class_folder_in = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var input_path = class_folder_in + country_name + '_' + 'classification' + '_' + region_name + '_' + name_x + '_v' + class_version_in;

var class_folder_out = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var gap_file_name_out = country_name + '_' + region_name + '_' + name_x + '_' + 'gapfill' + '_v' + gap_version_out;

var input_prob_path = class_folder_in + country_name + '_' + 'probability' + '_' + region_name + '_' + name_x + '_v' + class_version_in;
var gap_prob_file_name_out = country_name + '_' + region_name + '_' + name_x + '_' + 'probability_gapfill' + '_v' + gap_version_out;

var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var visLandsat = {"bands": ["swir1_median", "nir_median", "red_median"],"min": 0, "max": 5615, "gamma":1};

Map.addLayer(Land_collection.filter(ee.Filter.eq('year', yearInterest)).mosaic(), visLandsat, 'Landsat '+ yearInterest);

// Load the palettes module for visualization
//var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define visualization parameters for the classification bands
var vis = {bands: ['classification_'+yearInterest], min: 0, 
  max: 89, 
  palette: auxFuncs.paleta};
var visProb = {bands: ['probability_'+yearInterest], min: 0, 
  max: 1, 
  palette: auxFuncs.viridis};
  
// Load the classification image
var classification = ee.Image(input_path);
print('Input classification', classification);
var probability = ee.Image(input_prob_path);
print('Input probability', probability);

// Index of each year in the list of years
var years_index = ee.List.sequence(0, years.length - 1);

/**
 * @description 
 * Function to fill the missing values in the classification image.
 * @param current_year_index 
 * @param obj - The object containing the previous year image and the current year image.
 * @returns {Object} 
 */
var gap_fill = function (current_year_index, obj) {
    
    obj = ee.Dictionary(obj);

    // Get the previous year index as an integer
    var previous_year_index = ee.Number(current_year_index).subtract(1);

    // Get the previous image with all the bands
    var image_filled = ee.Image(obj.get('image_filled'));
    // Get the image base
    var image_base = ee.Image(obj.get('image_base'));

    // Get the current year image
    var current_image = image_base.select([ee.Number(current_year_index)]);
    // Get the previous year image
    var previous_image_filled = image_filled.select([previous_year_index]);

    // fill the missing values in the current year image
    var current_filled = current_image.unmask(previous_image_filled);

    // set the object with the previous year image
    // and the current year image
    obj = obj.set('image_filled', image_filled.addBands(current_filled));
    
    return obj;
};

/**
 * @description
 * Function to forward fill the missing values in the classification image.
 * It uses the previous year to fill the current year.
 * @param image - The classification image to be filled.
 * @returns {ee.Image} - The filled classification image.
 */
var forward_fill = function (image) {
    // Get the first year image
    var first = image.select([0]);

    // Iterate to fill missing bands
    var result = years_index.slice(1).iterate(gap_fill, {
        image_filled: first,
        image_base: image
    });

    // Extract the final result (all bands)
    return ee.Image(ee.Dictionary(result).get('image_filled'));
};

/**
 * @description
 * Function to backward fill the missing values in the classification image.
 * It uses the previous year to fill the current year.
 * @param image - The classification image to be filled.
 * @returns {ee.Image} - The filled classification image.
 */
var backward_fill = function (image) {
    // Reverse the order of the bands
    image = image.select(years_index.reverse());

    // Get the last year image
    var last = image.select([0]);

    // Iterate to fill missing bands
    // The first band is the last year, so we start from the second band
    // and iterate backwards
    var result = years_index.slice(1).iterate(gap_fill, {
        image_filled: last,
        image_base: image
    });

    // Extract the final result (all bands)
    // Reverse the order of the bands back to the original
    return ee.Image(ee.Dictionary(result).get('image_filled')).select(years_index.reverse());
};

// Apply the forward gap fill
var forward_filled = forward_fill(classification.selfMask());
var forward_filled_prob = forward_fill(probability.selfMask());

print('forward_filled_prob', forward_filled_prob);

// Apply the backward fill
var fully_filled = backward_fill(forward_filled);
var fully_filled_prob = backward_fill(forward_filled_prob);

var image = fully_filled;
var imageProb = fully_filled_prob;

// Map.addLayer(image, 
//   vis, 
//   'classification fully_filled');
// Map.addLayer(imageProb, 
//   visProb, 
//   'probability fully_filled_prob');
  
// Create a list of band names
var bandNames = ee.List(
    years.map(
        function (year) {
            return 'classification_' + String(year);
        }
    )
);
var bandNamesProb = ee.List(
    years.map(
        function (year) {
            return 'probability_' + String(year);
        }
    )
);

print('bandNames', bandNames);
print('bandNamesProb', bandNamesProb);

// Generate a histogram dictionary of band names and image band names
var bandsOccurrence = ee.Dictionary(
    bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);
var bandsOccurrenceProb = ee.Dictionary(
    bandNamesProb.cat(imageProb.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

print('bandsOccurrenceProb',bandsOccurrenceProb);
print('bandsOccurrence', bandsOccurrence);

// Create a dictionary of bands with masked bands
var bandsDictionary = bandsOccurrence.map(
    function (key, value) {
        return ee.Image(
            ee.Algorithms.If(
                ee.Number(value).eq(2),
                // If the band occurs twice, select the band from the original image
                image.select([key]).byte(),
                // If the band occurs once, create a masked band
                ee.Image().rename([key]).byte().updateMask(image.select(0))
            )
        );
    }
);
// Create the same dictionary for Prob
var bandsDictionaryProb = bandsOccurrenceProb.map(
    function (key, value) {
        return ee.Image(
            ee.Algorithms.If(
                ee.Number(value).eq(2),
                // If the band occurs twice, select the band from the original image
                imageProb.select([key]).byte(),
                // If the band occurs once, create a masked band
                ee.Image().rename([key]).byte().updateMask(imageProb.select(0))
            )
        );
    }
);

// Convert the dictionary to an image
var imageAllBands = ee.Image(
    bandNames.iterate(
        function (band, image) {
            // Add the band from the dictionary to the image
            return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
        },
        // Initialize the image with an empty selection
        ee.Image().select()
    )
);
// Same for probabilities
var imageAllBandsProb = ee.Image(
    bandNamesProb.iterate(
        function (band, image) {
            // Add the band from the dictionary to the image
            return ee.Image(image).addBands(bandsDictionaryProb.get(ee.String(band)));
        },
        // Initialize the image with an empty selection
        ee.Image().select()
    )
);

// Generate an image of pixel years
var imagePixelYear = ee.Image.constant(years)
    .updateMask(imageAllBands)
    .rename(bandNames);
var imagePixelYearProb = ee.Image.constant(years)
    .updateMask(imageAllBandsProb)
    .rename(bandNamesProb);
    
// Add connected pixels bands
var imageFilledConnected = image.addBands(
    image
        .connectedPixelCount(100, true)
        .rename(bandNames.map(
            function (band) {
                return ee.String(band).cat('_conn');
            }
        ))
);
var imageFilledConnectedProb = imageProb.addBands(
    imageFilledConnected.select('.*_conn'));
print('output classification', imageFilledConnected);
print('output probability', imageFilledConnectedProb);
    
// Define output path name based on the naming pattern
var output_name =  gap_file_name_out

// Export the processed classification image as a GEE asset
Export.image.toAsset({
    image: imageFilledConnected,
    description: output_name,
    assetId: class_folder_out + output_name,
    pyramidingPolicy: { '.default': 'mode' },
    region: imageFilledConnected.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite:true
});

// Export probability image
Export.image.toAsset({
    image: imageFilledConnectedProb,
    description: gap_prob_file_name_out,
    assetId: class_folder_out + gap_prob_file_name_out,
    pyramidingPolicy: { '.default': 'mean' },
    region: imageFilledConnected.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite:true
});

vis['bands'] = ['classification_'+yearInterest];

Map.addLayer(classification, vis, 'classification '+yearInterest);
Map.addLayer(imageFilledConnected.select(["classification_2000","classification_2001","classification_2002","classification_2003",
  "classification_2004","classification_2005","classification_2006","classification_2007",
  "classification_2008","classification_2009","classification_2010","classification_2011",
  "classification_2012",
  "classification_2013","classification_2014","classification_2015",
  "classification_2016","classification_2017","classification_2018","classification_2019",
  "classification_2020","classification_2021","classification_2022","classification_2023","classification_2024",
  "classification_2025"]), 
  vis, 
  'classification gap filled'+yearInterest);
Map.addLayer(imageFilledConnectedProb.select(["probability_2000","probability_2001","probability_2002","probability_2003",
  "probability_2004","probability_2005","probability_2006","probability_2007",
  "probability_2008","probability_2009","probability_2010","probability_2011",
  "probability_2012",
  "probability_2013","probability_2014","probability_2015",
  "probability_2016","probability_2017","probability_2018","probability_2019",
  "probability_2020","probability_2021","probability_2022","probability_2023","probability_2024",
  "probability_2025"]), 
  visProb, 
  'probability gap filled'+yearInterest);