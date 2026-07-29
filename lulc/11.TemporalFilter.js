// Import aux funcs
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// Define the territory name 
var country_name = 'MEX';

// Define the region name (needs match with the featureCollection names defined in the previous section)
var region_name = 4;

// Define youy name
var name_x = 'jvsv';

// One year after start
var startYear = 1985,
    endYear = 2025,
    yearInterest = 2025;

var gap_version_in = '1';
var tf_3window_version_out = '1';

//Do not need to change anything from here on---------
// List of years to be processed.
//Define years to process.
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 
            2019, 2020, 2021, 2022, 2023, 2024, 2025];
            
// Read classification regions
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(regions, "regiones");
// Filter only interest region
regions = regions.filterMetadata('Region', 'equals', region_name);

Map.addLayer(regions, {}, 'region ' + region_name);

// Read classification gapfill
var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/'
var input_path = class_folder + country_name + '_' + region_name + '_' + name_x + '_gapfill_v' + gap_version_in;
var input_prob_path = class_folder + country_name + '_' + region_name + '_' + name_x + '_probability_gapfill_v' + gap_version_in;

var tf_3window_file_name_out = 'gapfill_temporal'

var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var visLandsat = {"bands": ["swir1_median", "nir_median", "red_median"],"min": 0, "max": 5615, "gamma":1};

Map.addLayer(Land_collection.filter(ee.Filter.eq('year', yearInterest)).mosaic(), visLandsat, 'Landsat ' + yearInterest);

// Import the palettes module
// var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define the palettes for visualization
var vis = {
  min: 0, 
  max: 89, 
  palette: auxFuncs.paleta,
  format: 'png'
};

var visProb = {
  min: 0, 
  max: 1, 
  palette: auxFuncs.viridis,
  format: 'png'
};

var class_gap_fill = ee.Image(input_path)
print('class_gap_fill', class_gap_fill);
var prob_gap_fill = ee.Image(input_prob_path)

class_gap_fill = class_gap_fill.addBands(prob_gap_fill);

Map.addLayer(class_gap_fill.select('classification_'+yearInterest), vis, 'classification input' + yearInterest);
Map.addLayer(class_gap_fill.select('probability_'+yearInterest), visProb, 'probability input' + yearInterest);

//var class_gap_fill = class_gap_fill
//  .addBands(class_gap_fill.select('classification_2011').rename('classification_2012'))

// Load the palettes module for visualization
// var palettes = require('users/mapbiomas/modules:Palettes.js');

// Define visualization parameters for the classification bands
// var vis = {
//     'min': 0,
//     'max': 69,
//     'palette': palettes.get('drc'),
//     'format': 'png'
// };

// var vis2 = {
//     bands: 'classification_'+yearInterest,
//     min: 0, 
//     max: 89, 
//     palette: auxFuncs.paleta,
//     format: 'png'
// };

// Lista de anos (atualize aqui e o resto do código se ajusta automaticamente)
// Sempre sem os anos das bordas pois eles nao terao um antes e um depois, isso daria erro no script. Basta adiciona-los depois.
var anos = ee.List.sequence(startYear+1, endYear-1)                                                           
                  .map(function(y){                                                     
                        return ee.Number(y).int(); });
                        
var window3y = function (img, classe){
                var classWindPre = ee.ImageCollection(anos.map(function(ano){
                    ano = ee.Number(ano)
                    var anoStr = ano.format();  
                    var nomeBanda = ee.String('classification_').cat(anoStr);

                    // Definindo imagens para ano atual, anterior e seguinte
                    var class_Ano = img.select(nomeBanda);
                    var classPrev = img.select(ee.String('classification_').cat(ano.subtract(1).format()));
                    var classNext = img.select(ee.String('classification_').cat(ano.add(1).format()));
                    
                    var prob_Ano = img.select(ee.String('probability_').cat(anoStr));
                    var probPrev = img.select(ee.String('probability_').cat(ano.subtract(1).format()));
                    var probNext = img.select(ee.String('probability_').cat(ano.add(1).format()));
                    
                    // Create a mask for the 3-year window
                    var mask_3 = classNext.neq(classe)
                            .and(class_Ano.eq(classe))
                            .and(classPrev.neq(classe));
       
                    // Remap the classification for the previous year and apply the mask
                    // Water is not included due to possible changes during the 
                    mask_3 = classPrev.remap([88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34],
                                             [88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34]).updateMask(mask_3);
                                             
                    // Blend the original classification with the masked classification
                    var class_corr = class_Ano.blend(mask_3.rename(nomeBanda));
                    var prob_corr = prob_Ano.blend(mask_3.rename(ee.String('probability_').cat(anoStr)));
          
                    return class_corr.addBands(prob_corr);
                                                            }));
                                                            
        var classWind = classWindPre.select('classification_.*').toBands();
        var probWind = classWindPre.select('probability_.*').toBands();
        
                                                            //print('classWind',classWind)
        var n = anos.size(); // tamanho da lista                                                      
        var ultimo = ee.Number(anos.get(n.subtract(1))).add(1); 
        var primero = ee.Number(anos.get(0)).subtract(1);
        // print(primero)
        //print(ultimo)
        //print(n)
                    
        // Garante que 'classification_1985' e 'classification_2024' esteja incluída
        // !!!! Changed to use first year as 1985 and last as 2025
        var class_pri = img.select([ee.String('classification_').cat(primero)], 
                                        [ee.String('00_classification_').cat(primero)]);
        var class_ult = img.select([ee.String('classification_').cat(ultimo)], 
                                        [ee.String('00_classification_').cat(ultimo)]);
        var class_final = class_pri.addBands(classWind).addBands(class_ult);
        
        var prob_pri = img.select([ee.String('probability_').cat(primero)], 
                                        [ee.String('00_probability_').cat(primero)]);
        var prob_ult = img.select([ee.String('probability_').cat(ultimo)], 
                                        [ee.String('00_probability_').cat(ultimo)]);
        var prob_final = prob_pri.addBands(probWind).addBands(prob_ult);
        //print('class_final',class_final)
                                                            
        var corrIndx = function (img){
              var indxNames = img.bandNames()                                                 
              var bandNames = indxNames.map(function(nome){                                   
                  return ee.String(nome).split('_').slice(1).join('_');
                                                          });
              return img.select(indxNames,bandNames)                                        
            }
        var corrigidaFinal = corrIndx(class_final)
        var corrigidaProbFinal = corrIndx(prob_final)
        
        //print('corrigidaFinal',corrigidaFinal)
        return corrigidaFinal.addBands(corrigidaProbFinal)
                
};

// Apply the 3-year moving window filter for different classes
var filtered = window3y(class_gap_fill,  88);
    filtered = window3y(filtered, 89);
    filtered = window3y(filtered, 3);
    filtered = window3y(filtered, 5);
    filtered = window3y(filtered, 66);
    filtered = window3y(filtered, 45);
    filtered = window3y(filtered, 11);
    filtered = window3y(filtered, 15);
    filtered = window3y(filtered, 36);
    filtered = window3y(filtered, 19);
    filtered = window3y(filtered, 9);
    filtered = window3y(filtered, 21);
    filtered = window3y(filtered, 24);
    filtered = window3y(filtered, 25);
    filtered = window3y(filtered, 33);
    filtered = window3y(filtered, 34);
    
print('Output prob', filtered);

// Add the original and filtered images to the map
// Map.addLayer(class_gap_fill
//   .select(['classification_2000', 'classification_2001', 'classification_2002', 
//   'classification_2003', 'classification_2004', 'classification_2005', 'classification_2006',
//   'classification_2007', 'classification_2008', 'classification_2009', 'classification_2010',
//   'classification_2011', 'classification_2012', 'classification_2013', 'classification_2014',
//   'classification_2015', 'classification_2016', 'classification_2017', 'classification_2018',
//   'classification_2019', 'classification_2020', 'classification_2021', 'classification_2022',
//   'classification_2023', 'classification_2024', 'classification_2021']), vis2, 'Input Collection '+yearInterest, false);


// Map.addLayer(filtered, vis2, 'Filtered Collection', false);

// Add the classifications for 2020 to the map
Map.addLayer(class_gap_fill.select('classification_' +yearInterest), vis, 'Input ' + yearInterest, true);
Map.addLayer(filtered.select('classification_' +yearInterest), vis, 'Filtered classification' + yearInterest, true);
Map.addLayer(filtered.select('probability_' +yearInterest), visProb, 'Filtered probability' + yearInterest, true);

var output_name = country_name + '_' + region_name + '_' + name_x +  '_' + tf_3window_file_name_out + '_v' + tf_3window_version_out;
var output_prob_name = country_name + '_' + region_name + '_' + name_x +  '_probability_' + tf_3window_file_name_out + '_v' + tf_3window_version_out;
print(output_name);

// Export the final classification image to an asset
Export.image.toAsset({
    "image": filtered.select('classification_.*'),
    'description': output_name,
    'assetId': class_folder+output_name,
    "scale": 30,
    "pyramidingPolicy": {
        '.default': 'mode'
    },
    "maxPixels": 1e13,
    'region': filtered.geometry().bounds(),
    overwrite:true
});

// Export probability image
Export.image.toAsset({
    "image": filtered.select('probability_.*'),
    'description': output_prob_name,
    'assetId': class_folder+output_prob_name,
    "scale": 30,
    "pyramidingPolicy": {
        '.default': 'mode'
    },
    "maxPixels": 1e13,
    'region': filtered.geometry().bounds(),
    overwrite:true
});