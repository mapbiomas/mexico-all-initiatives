// Aux functions
// Clip Landsat mosaics by region and subregion
var corteSubreg = function(Land_collection, ecoregsN1, region, year){
  return ee.ImageCollection(Land_collection).filter(ee.Filter.eq('year', year))
                        .filterBounds(ecoregsN1)
                        .mosaic()
                        .clip(region)
                        .clip(ecoregsN1);
};
// Clip Landsat mosaics by region
var corteReg = function(Land_collection, region, year){
  return ee.ImageCollection(Land_collection).filter(ee.Filter.eq('year', year))
                        //.filterBounds(ecoregsN1)
                        .mosaic()
                        .clip(region);
                        //.clip(ecoregsN1);
};

// Function to generate a centroid for each polygon, taken from original Mapbiomas scripts
function getCentroids(fc) {
  return ee.FeatureCollection(fc).map(function(feature) {
    return ee.Feature(feature.geometry().centroid(30))
             .copyProperties(feature);
  });
}

// Function to add only classes that have at least one sample to the feature collection,
// taken from original Mapbiomas scripts
function safeMerge(trainPolys, fc, classValue) {
  return ee.FeatureCollection(ee.Algorithms.If(
    fc.size().gt(0),
    trainPolys.merge(fc.map(function(f) {
      return f.set('class', classValue);
    })),
    trainPolys
  ));
}

// New palette 0 - 89
// Check legend palette: 
// https://docs.google.com/spreadsheets/d/1tD5964nCNxU-nG4LSaKTuKIGA_0idz03/edit?usp=sharing&ouid=103155354454336085469&rtpof=true&sd=true
// var paleta = ee.List.repeat('#1f8d49', 4) // Bosque_Tropical_humedo: 3
//                             .cat(ee.List.repeat('#FF12A8', 2)) // Manglar: 5
//                             .cat(ee.List.repeat('#7a5900', 4)) // Plantacion_forestal: 9
//                             .cat(ee.List.repeat('#a89358', 2)) // Inundables: 11
//                             .cat(ee.List.repeat('#edde8e', 4)) // Pastizales_cultivados: 15
//                             .cat(ee.List.repeat('#C27BA0', 4)) // Cultivos_anuales: 19
//                             .cat(ee.List.repeat('#ffefc3', 2)) // Mosaico_de_usos: 21
//                             .cat(ee.List.repeat('#d4271e', 3)) // Area_urbana_y_construida: 24
//                             .cat(ee.List.repeat('#db4d4f', 1)) // Areas_sin_vegetacion: 25 
//                             .cat(ee.List.repeat('#2532e4', 8)) // Rios_lagos_y_mares: 33
//                             .cat(ee.List.repeat('#93dfe6', 1)) // Glaciares: 34
//                             .cat(ee.List.repeat('#d082de', 2)) // Cultivo_perenne: 36
//                             .cat(ee.List.repeat('#807a40', 9)) // Sabanas_y_pastizales_naturales: 45
//                             .cat(ee.List.repeat('#519799', 21)) // Matorral: 66
//                             .cat(ee.List.repeat('#329c5a', 22)) // Bosque_Templado: 88
//                             .cat(ee.List.repeat('#6bd46c', 1)); // Bosque_Tropical_seco: 89


// Print paleta to console, copy/paste as formatted text
// Palette corresponds to the agreed LULC palette
var paleta = [
  "#1f8d49",
  "#1f8d49",
  "#1f8d49",
  "#1f8d49",
  "#FF12A8",
  "#FF12A8",
  "#7a5900",
  "#7a5900",
  "#7a5900",
  "#7a5900",
  "#a89358",
  "#a89358",
  "#edde8e",
  "#edde8e",
  "#edde8e",
  "#edde8e",
  "#C27BA0",
  "#C27BA0",
  "#C27BA0",
  "#C27BA0",
  "#ffefc3",
  "#ffefc3",
  "#d4271e",
  "#d4271e",
  "#d4271e",
  "#db4d4f",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#2532e4",
  "#93dfe6",
  "#d082de",
  "#d082de",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#807a40",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#519799",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#329c5a",
  "#6bd46c"
];

// Create a viridis palette for probabilities
var viridis = ['#440154','#482878','#3E4989','#31688E', '#26828E', '#F9E721'];

// Export auxiliary functions
exports = {
  corteSubreg: corteSubreg,
  corteReg: corteReg,
  getCentroids: getCentroids,
  safeMerge: safeMerge,
  paleta: paleta,
  viridis: viridis
};