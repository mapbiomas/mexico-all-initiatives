// DEPRECATED: Part of the MapBiomas Mexico Collection 1.0 data flow; retained for historical reference.
// Versión script 20/07/2026
// 8. Spatial filter (salt & pepper) - NATIONAL PRODUCT
// Input:  MEX_integration_alequech_gapfill_temporal_v1

// Description:
// Removes isolated pixel clusters (salt & pepper) year by year: where a class
// patch has fewer connected pixels than filter_size, those pixels are replaced
// with the focal mode of their 3x3 neighborhood.

// Note:
// The probability branch is disabled (commented) in this run.

// Import aux funcs
var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
// Define the territory name
var country_name = 'MEX';

// (reference only; input is already national)
var region_name = 4;
var name_x = 'jvsv';

// Read classification regions (buffered, reference layer)
var buffkm = 5;
var regions = ee.FeatureCollection('projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico_'+buffkm+'kmbuff');
print(regions, "regiones");

// Filter only interest region
// regions = regions.filterMetadata('Region', 'equals', region_name);

// List of years to be processed.
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001,
            2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018,
            2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Define the minimum number of connected pixels
var filter_size = 6;

var spatial_version_out = '1';

/////////////////////////////

var class_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';

// # Input / output----
// National input (output of the national temporal filter)
var input_path = class_folder + 'MEX_integration_alequech_gapfill_temporal_v1';
// var input_prob_path = class_folder + country_name + '_' + region_name + '_' +  name_x + '_probability_gapfill_temporal_v' + temporal_version_in;

var spatial_file_name_out = 'gapfill_temporal_spatial';

// # Palette / reference mosaic----
var Land_collection = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var visLandsat = {"bands": ["swir1_median", "nir_median", "red_median"],"min": 0, "max": 5615, "gamma":1};

Map.addLayer(Land_collection.filter(ee.Filter.eq('year', 2024)).mosaic(), visLandsat, 'Landsat 2024');

// Define visualization parameters for the classification bands
/*var vis = {
    min: 0,
    max: 89,
    palette: auxFuncs.paleta,
    'format': 'png'
};
*/

var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');

// var visProb = {
//     min: 0,
//     max: 1,
//     palette: auxFuncs.viridis,
//     'format': 'png'
// };

// # Read input----
// Load the classification image (probability commented out)
var classification = ee.Image(input_path);
// var probability = ee.Image(input_prob_path);
print(classification);
// classification = classification.addBands(probability);

///*************************************************************
// Do not Change from these lines
////*************************************************************

// Add the classification image to the map
Map.addLayer(classification.select('classification_2024'), vis, 'Input 2024');

// # Spatial filter----
// create an empty container
var filtered = ee.Image([]);

// apply filter
years.forEach(function(year_i) {
        // compute the focal mode (3x3 neighborhood majority class)
        var focal_mode = classification.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});

        // Using focal mean to set probability of the pixels that are being substituted
        // using the spatial filters
        // var focal_mean = classification.select(['probability_' + year_i])
        //         .unmask(0)
        //         .focal_mean({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});

        // compute te number of connections
        var connections = classification.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});

        // get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));
        // var to_maskProb = focal_mean.updateMask(connections.lte(filter_size));

        // apply filter (blend the focal mode only where the patch is too small)
        var classification_i = classification.select(['classification_' + year_i])
                .blend(to_mask)
               // .reproject('EPSG:4326', null, 30);
        // var probability_i = classification.select(['probability_' + year_i])
        //         .blend(to_maskProb)
        //         .reproject('EPSG:4326', null, 30);

        // stack into container
        filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
        //                    .addBands(probability_i.updateMask(probability_i.neq(0)));
        }
      );

// print filtered
Map.addLayer(filtered.select(['classification_2025']), vis, 'Filtered classification 2025');
// Map.addLayer(filtered.select(['probability_2025']), visProb, 'Filtered probability 2025');

// # Export----
// National output name  (<-- CONFIRM)
var output_name = 'MEX_integration_alequech_gapfill_temporal_spatial_v' + spatial_version_out;
// var otuput_prob_name = country_name + '_' + region_name + '_' + name_x + '_probability_gapfill_temporal_spatial_v' + spatial_version_out;

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
// Export.image.toAsset({
//     'image': filtered.select('probability_.*'),
//     'description': otuput_prob_name,
//     'assetId': class_folder+otuput_prob_name,
//     'pyramidingPolicy': {
//         '.default': 'mean'
//     },
//     'region': classification.geometry().bounds(),
//     'scale': 30,
//     'maxPixels': 1e13,
//     overwrite:true
// });

// # Legend----
var legendData = [
  [88, 'Bosques Templados',                  '1. Bosques'],
  [89, 'Bosques Tropicales secos',           '1. Bosques'],
  [3,  'Bosques Tropicales húmedos',         '1. Bosques'],
  [5,  'Manglares',                          '1. Bosques'],
  [66, 'Matorrales',                         '2. Veget herbácea y arbustiva'],
  [45, 'Sabanas y pastizales naturales',     '2. Veget herbácea y arbustiva'],
  [11, 'Inundables',                         '2. Veget herbácea y arbustiva'],
  [15, 'Pastizales cultivados e inducidos',  '3. Agropecuario'],
  [36, 'Cultivo perenne',                    '3. Agropecuario'],
  [19, 'Cultivos anuales',                   '3. Agropecuario'],
  [9,  'Plantación forestal',                '3. Agropecuario'],
  [21, 'Mosaico de usos',                    '3. Agropecuario'],
  [24, 'Área urbana y construída',           '4. No Vegetado'],
  [25, 'Áreas sin vegetación',               '4. No Vegetado'],
  [33, 'Ríos, lagos y mares',                '5. Cuerpos de agua'],
  [34, 'Glaciares',                          '5. Cuerpos de agua'],
  [27, 'No observado',                       '6. No observado']
];

// Legend colors (from the module palette, indexed by class id)
var moduloPalette = vis.palette;
var classColors = {
  3:  moduloPalette[3],
  5:  moduloPalette[5],
  9:  moduloPalette[9],
  11: moduloPalette[11],
  15: moduloPalette[15],
  19: moduloPalette[19],
  21: moduloPalette[21],
  24: moduloPalette[24],
  25: moduloPalette[25],
  27:  moduloPalette[27],
  33: moduloPalette[33],
  34: moduloPalette[34],
  36: moduloPalette[36],
  45: moduloPalette[45],
  66: moduloPalette[66],
  88: moduloPalette[88],
  89: moduloPalette[89]
};

var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px',
    backgroundColor: 'rgba(255,255,255,0.85)'
  }
});

legend.add(ui.Label({
  value: 'Cubiertas y usos del suelo',
  style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0' }
}));

var makeRow = function(color, id, name) {
  return ui.Panel({
    widgets: [
      ui.Label({
        style: {
          backgroundColor: color,
          padding: '8px',
          margin: '0 2px 3px 0',
          border: '1px solid #999'
        }
      }),
      ui.Label({
        value: id + ' – ' + name,
        style: { margin: '0 0 3px 4px', fontSize: '11px' }
      })
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
};

var currentGroup = '';
for (var i = 0; i < legendData.length; i++) {
  var id    = legendData[i][0];
  var name  = legendData[i][1];
  var group = legendData[i][2];

  if (group !== currentGroup) {
    legend.add(ui.Label({
      value: group,
      style: { fontWeight: 'bold', fontSize: '11px', margin: '6px 0 2px 0', color: '#444' }
    }));
    currentGroup = group;
  }

  legend.add(makeRow(classColors[id], id, name));
}

Map.add(legend);
