// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// Compile the map of all regions and integrate it into a single one 
// define path
var path = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/'

// Define the name of the country
var country_name = 'MEX';

// Define the folder in which integrated map will be placed  
var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var merge_name_out = 'integration';   // Define the name of the integrated map 
var merge_version_out = '1';                   // Define the version of the integrated map 

// ## Visualization region
var startYear = 1985;
var endYear = 2025;
var interestYear = 2025;

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

//Define region to process.
/*
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            */
// Use years as a server-side object to map classification process over years.            
var years = ee.List.sequence(startYear, endYear, 1);

// Read classification regions
// Read regions without buffer to create final outputs
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico');
var regionExp = regions.union(30);
Map.addLayer(regionExp, {}, 'regionExp', false)
print("Regiones: ", regions.aggregate_array('Region'));

// Load the palettes module for visualization
// var palettes = require('users/mapbiomas/modules:Palettes.js');
// Define visualization parameters for the classification bands
var vis = {
    min: 0, 
    max: 89, 
    palette: auxFuncs.paleta,
    'format': 'png'
};

// Initialize an empty list to receive classifications 
var img_col = ee.List([]);
var img_colProb = ee.List([]);

// Define the classification version of each region 
//var R1 = ee.Image(path + country_name + '_' + '1' + '_' + 'sama' + '_gapfill_temporal_spatial_' + 'v1');
//var R1Prob = ee.Image(path + country_name + '_' + '1' + '_' + 'sama' + '_probability_gapfill_temporal_spatial_' + 'v1');
//var R2 = ee.Image(path + country_name + '_' + '2' + '_' + 'MIUC' + '_gapfill_temporal_spatial_' + 'v1');
//var R2Prob = ee.Image(path + country_name + '_' + '2' + '_' + 'MIUC' + '_probability_gapfill_temporal_spatial_' + 'v1');
//var R3 = ee.Image(path + country_name + '_' + '3' + '_' + 'MaryFlores' + '_gapfill_temporal_spatial_' + 'v1');
//var R3Prob = ee.Image(path + country_name + '_' + '3' + '_' + 'MaryFlores' + '_probability_gapfill_temporal_spatial_' + 'v1');
var R4 = ee.Image(path + country_name + '_' + '4' + '_' + 'jvsv' + '_gapfill_temporal_spatial_' + 'v1');
var R4Prob = ee.Image(path + country_name + '_' + '4' + '_' + 'jvsv' + '_probability_gapfill_temporal_spatial_' + 'v1');
//var R5 = ee.Image(path + country_name + '_' + '5' + '_' + 'daniel_auliz' + '_gapfill_temporal_spatial_' + 'v1');
//var R5Prob = ee.Image(path + country_name + '_' + '5' + '_' + 'daniel_auliz' + '_probability_gapfill_temporal_spatial_' + 'v1');

//Map.addLayer(Mosaic.select('classification_2024'), vis, 'Mosaic')
// Merge classifications
//img_col = img_col.add(R1);
//img_col = img_col.add(R2);
//img_col = img_col.add(R3);
img_col = img_col.add(R4);
//img_col = img_col.add(R5);

//Merge probabilities
//img_colProb = img_colProb.add(R1);
//img_colProb = img_colProb.add(R2);
//img_colProb = img_colProb.add(R3);
img_colProb = img_colProb.add(R4Prob);
//img_colProb = img_colProb.add(R5);

// Print classifications
print(img_col);

// Original mapbiomas
// Create an image collection from the list of images
// var img_mosaic = ee.ImageCollection.fromImages(img_col).mosaic();
// print(img_mosaic);

// // Plot the integrated classification 
// Map.addLayer(img_mosaic.select("classification_2024"), vis, 'Merge 2024');

// Modified version
print('regions.size()', regions.size());
var regionesNum = regions.size();
regionesNum = ee.Number(1);

var resul = ee.ImageCollection.fromImages(
                ee.List.sequence(0,regionesNum.subtract(1))
                   .map(function(i){
                      var classIm = ee.Image(img_col.get(ee.Number(i)));
                      var probIm = ee.Image(img_colProb.get(ee.Number(i)));
                      
                      var stackedIm = years.map(function(year){
                          var clasif = classIm.select(ee.String('classification_').cat(ee.Number(year).round().int()));
                          var prob = probIm.select(ee.String('probability_').cat(ee.Number(year).round().int()));
                          return(clasif.addBands(prob).set('year', ee.Number(year), 
                                                           'subregion', ee.Number(i)));
                        });
                      return stackedIm;
                    }).flatten());

print('resul', resul);

var yearsString = years.map(function(year){
                                      return ee.String('classification_').cat(ee.String(ee.Number(year).round().int()));
                                    });

var probString = years.map(function(year){
                                      return ee.String('probability_').cat(ee.String(ee.Number(year).round().int()));
                                    });

// Classification                                    
var img_mosaic = ee.ImageCollection.fromImages(years.map(function(year){
  return resul.filter(ee.Filter.eq('year', ee.Number(year).round().int()))
      // Mosaic with max value of probability
      .qualityMosaic(ee.String('probability_').cat(ee.Number(year).round().int()))
      .select(ee.String('classification_').cat(ee.Number(year).round().int()))
      .rename(ee.String('classification_').cat(ee.Number(year).round().int()));
})).toBands()
   .rename(yearsString);

var imgProb_mosaic = ee.ImageCollection.fromImages(years.map(function(year){
  return resul.filter(ee.Filter.eq('year', ee.Number(year).round().int()))
      // Mosaic with max value of probability
      .qualityMosaic(ee.String('probability_').cat(ee.Number(year).round().int()))
      .select(ee.String('probability_').cat(ee.Number(year).round().int()))
      .rename(ee.String('probability_').cat(ee.Number(year).round().int()));
})).toBands()
   .rename(probString);

print('img_mosaic', img_mosaic);

//input
Map.addLayer(ee.Image(img_col.get(0)).select('classification_'+interestYear), vis, 'img_mosaic '+interestYear);
Map.addLayer(ee.Image(img_colProb.get(0)).select('probability_'+interestYear), visProb, 'img_mosaic_prob '+interestYear);

// output
Map.addLayer(img_mosaic.select('classification_'+interestYear), vis, 'img_mosaic '+interestYear);
Map.addLayer(imgProb_mosaic.select('probability_'+interestYear), visProb, 'imgProb_mosaic '+interestYear);


// Define output path name based on the naming pattern
var output_name = country_name + '_' + merge_name_out + '_v' + merge_version_out;
var output_prob_name = country_name + '_' + merge_name_out + '_probability_v' + merge_version_out;

// Export the processed classification image as a GEE asset
Export.image.toAsset({
    image: img_mosaic,
    description: output_name,
    assetId: class_folder + output_name,
    pyramidingPolicy: {'.default': 'mode'},
    region: regionExp,
    scale: 30,
    maxPixels: 1e13
});

// print('salida asset integrado', class_folder + output_prob_name);

Export.image.toAsset({
    image: imgProb_mosaic,
    description: output_prob_name,
    assetId: class_folder + output_prob_name,
    pyramidingPolicy: {'.default': 'mean'},
    region: regionExp,
    scale: 30,
    maxPixels: 1e13
});
