// Create mosaic for the complete region using probabilities to 
// stitch together all the subregions
// # Read aux functions, common functions used in several scripts
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// Add year to visualize its classification
var yearVis = 2025;

// Define name of region coordinator that exported classifications made with stable samples only
var name_x = 'jvsv';

// region, subregion, start and end years
var region_name = 4;
var subregion_names = [12, 13, 14, 15];
var startYear = 1985;
var endYear = 2025;

// Use years as a server-side object to map classification process over years.            
var years = ee.List.sequence(startYear, endYear, 1);

// Do not need to move anything else from here on -----
// Define the name of the country 
var country_name = 'MEX';

// Define the folder to read classification 
var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var classification_name_out = 'classification'; // Define the name of the classification collection 
var probability_name_out = 'probability'; // Define the name of the probability collection 
var classification_version_out = '1';           // Define the version of the classification 

// Build the name of the classification output 
var class_name = [];
for(var i=0; i<subregion_names.length; i++){
  class_name[i] = class_folder+country_name + '_' + classification_name_out + '_' + region_name+ '_' + subregion_names[i]+ '_' +name_x + '_v' + classification_version_out ;
}
print('class_name', class_name);

var prob_name = [];
for(var i=0; i<subregion_names.length; i++){
  prob_name[i] = class_folder+country_name + '_' + probability_name_out + '_' + region_name+ '_' + subregion_names[i]+ '_' +name_x + '_v' + classification_version_out ;
}
print('class_name', class_name);

// Read classified images  
var imClass = ee.List(class_name.map(function(loc){
  return ee.Image(loc);
}));

print('imClass', imClass);

// Read probability images
var imProb = ee.List(prob_name.map(function(loc){
  return ee.Image(loc);
}));

print('imProb', imProb);

// Loop over each subregion
var nSubregions = ee.List(subregion_names).size();
print('subregions', nSubregions);

var resul = ee.ImageCollection.fromImages(
                ee.List.sequence(0,nSubregions.subtract(1))
                   .map(function(i){
                      var classIm = ee.Image(imClass.get(ee.Number(i)));
                      var probIm = ee.Image(imProb.get(ee.Number(i)));
                      
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
                                    
// Probability
var resulProb = ee.ImageCollection.fromImages(years.map(function(year){
  return resul.filter(ee.Filter.eq('year', ee.Number(year).round().int()))
      // Mosaic with max value of probability
      .qualityMosaic(ee.String('probability_').cat(ee.Number(year).round().int()))
      .select(ee.String('probability_').cat(ee.Number(year).round().int()))
      .rename(ee.String('probability_').cat(ee.Number(year).round().int()));
})).toBands()
   .rename(probString);

// Classification                                    
resul = ee.ImageCollection.fromImages(years.map(function(year){
  return resul.filter(ee.Filter.eq('year', ee.Number(year).round().int()))
      // Mosaic with max value of probability
      .qualityMosaic(ee.String('probability_').cat(ee.Number(year).round().int()))
      .select(ee.String('classification_').cat(ee.Number(year).round().int()))
      .rename(ee.String('classification_').cat(ee.Number(year).round().int()));
})).toBands()
   .rename(yearsString);

print('resul', resul);

// Compare with result by region
var class_nameSingle = country_name + '_' + classification_name_out + '_' + region_name+ '_' +name_x + '_v' + classification_version_out ;
var prob_nameSingle = country_name + '_' + probability_name_out + '_' + region_name+ '_' +name_x + '_v' + classification_version_out ;
print('class_nameSingle', class_nameSingle);
// var imClassSingle = ee.Image(class_nameSingle).select('classification_'+yearVis)

var buffkm = 5;
var region_training = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
// Select only the region of interest 
var region = region_training.filter(ee.Filter.eq('Region', region_name));

Map.addLayer(region, {}, 'region con buffer');

// Check subregions
var ecoregsN1 = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/ecorregiones_n1_2km_buff')
                                .filterBounds(region);
                                
Map.addLayer(ecoregsN1,{},'Subregion Limit', false);  // Add subregion to the map 

// Define visualization parameters for the classification bands
// LULC palette
var visLulc = {min: 0, 
  max: 89, 
  palette: auxFuncs.paleta,
  opacity: 1
};

// Probability palette
var visProb = {min:0, max:1, 
  palette:auxFuncs.viridis};
  
// Lulc classes
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

Map.addLayer(resul.select('classification_'+yearVis).clip(region), visLulc, 'Classification by subregions'+ yearVis);
Map.addLayer(resulProb.select('probability_'+yearVis).clip(region), visProb, 'Probability by subregions'+ yearVis);
// Map.addLayer(imClassSingle.select('classification_'+yearVis).clip(region), visLulc, 'Classification by region'+ yearVis);

// Check histogram for classes of interest
var histograma = ee.Dictionary(resul.select('classification_'+yearVis)
  .reduceRegion({
    reducer: ee.Reducer.frequencyHistogram().unweighted(),
    geometry: region,
    scale: 300
  }).get('classification_'+yearVis)).select(['3', '5', '9', '11','15', '19', '21', '24', '25', '33',
  '34', '36', '45', '66', '88', '89']);
  
print('histograma clases válidas' + 'classification_'+yearVis , histograma);

// Export mosaic to asset. Single mosaic by region
Export.image.toAsset({
    "image": resul,
    "description": class_nameSingle,
    "assetId": class_folder + class_nameSingle,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mode'},
    "maxPixels": 1e13,
    "region": region,
    overwrite: true
}); 

// Export probability
Export.image.toAsset({
    "image": resulProb,
    "description": prob_nameSingle,
    "assetId": class_folder + prob_nameSingle,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mean'},
    "maxPixels": 1e13,
    "region": region,
    overwrite: true
}); 

//-------- Add legend---------------------
// set position of panel
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px'
  }
});
 
// Create legend title
var legendTitle = ui.Label({
  value: 'Cubiertas y usos del suelo',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '0'
    }
});
 
// Add the title to the panel
legend.add(legendTitle);
 
// Creates and styles 1 row of the legend.
var makeRow = function(color, name) {
 
      // Create the label that is actually the colored box.
      var colorBox = ui.Label({
        style: {
          backgroundColor: color,
          // Use padding to give the box height and width.
          padding: '8px',
          margin: '0 0 4px 0'
        }
      });
 
      // Create the label filled with the description text.
      var description = ui.Label({
        value: name,
        style: {margin: '0 0 4px 6px'}
      });
 
      // return the panel
      return ui.Panel({
        widgets: [colorBox, description],
        layout: ui.Panel.Layout.Flow('horizontal')
      });
};
 
//  Palette with the colors
var palette = ['#1f8d49',
'#FF12A8', 
'#7a5900', 
'#a89358', 
'#edde8e', 
'#C27BA0', 
'#ffefc3', 
'#d4271e', 
'#db4d4f', 
'#2532e4', 
'#93dfe6', 
'#d082de', 
'#807a40', 
'#519799', 
'#329c5a', 
'#6bd46c'];
 
// name of the legend
var names = ['Bosque_Tropical_humedo' , 
'Manglar' , 
'Plantacion_forestal' , 
'Inundables' , 
'Pastizales_cultivados' , 
'Cultivos_anuales' , 
'Mosaico_de_usos' , 
'Area_urbana_y_construida' , 
'Areas_sin_vegetacion' ,  
'Rios_lagos_y_mares' , 
'Glaciares' , 
'Cultivo_perenne' , 
'Sabanas_y_pastizales_naturales' , 
'Matorral' , 
'Bosque_Templado' , 
'Bosque_Tropical_seco' ];
 
// Add color and and names
for (var i = 0; i < 16; i++) {
  legend.add(makeRow(palette[i], names[i]));
  }  
 
// add legend to map (alternatively you can also print the legend to the console)
Map.add(legend);