// Temporal mode for natural vegetation (after the arb_mgl_gf_tf3_tf6_urb pipeline)
// Version: 2026-10-07 (output asset overwriting controlled by OVERWRITE)
// Input:  COLLECTION-1/TMP/MEX_<reg>_<name>_arb_mgl_gf_tf3_tf6_urb_v1
// Output: COLLECTION-1/TMP/MEX_<reg>_<name>_arb_mgl_gf_tf3_tf6_urb_moda_v1
//
// For each pixel, count the years assigned to each natural vegetation class in NAT.
// Replace every natural vegetation observation with the most frequent class (temporal mode).
// Classes outside NAT (agriculture, pasture, urban, water, mangrove, etc.) are excluded and remain unchanged.
//   Examples: BTH = tropical rain forest (3), I = wetland (11), A = agriculture (19).
//   BTH BTH A A I I I I I I I I I I I BTH BTH -> I I A A I I I I I I I I I I I I I
// Break ties using the most recent natural vegetation class if it is among the tied classes;
// otherwise, use the first tied class in NAT.
// Mangrove (5) is intentionally excluded from NAT because it comes from the thematic layer.
//
// Pipeline order: 10.hVgNatural_MGafill_ft3_ft6.js -> this script -> 12.update_85_99.js.
// This script does not fill gaps. If gap filling changes in the 2000-2025 pipeline, rerun it
// so the 1985-1999 reconstruction uses the updated reference.

// # Configuration ----
var country_name = 'MEX';
var region_name = 5;
var name_x = 'alequech';
var version_in = '1';
var version_out = '1';

var ANIO_INICIO = 2000;
var ANIO_FIN = 2025;
var yearInterest = 2008;

var NAT = [3, 11, 66, 88, 89];   // Natural vegetation classes included in the mode; order defines fallback tie priority
var MIN_ANIOS_NAT = 1;           // Minimum frequency of the modal natural vegetation class required to apply replacement

var LAUNCH_EXPORTS = true;
var OVERWRITE = true;            // true: overwrite the output asset if it already exists
var SHOW_LAYERS = true;
var RUN_QA = true;
var INSPECTOR = true;
var PUNTO_INICIAL = [-90.035662, 20.931135];   // Set to null to skip pixel inspection on load

var tmp_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/TMP/';

// No further configuration is required below this line. -----

var years = [];
for (var y = ANIO_INICIO; y <= ANIO_FIN; y++) { years.push(y); }
var nYears = years.length;
var bandNames = years.map(function(y) { return 'classification_' + y; });

var input_name = country_name + '_' + region_name + '_' + name_x + '_arb_mgl_gf_tf3_tf6_urb_v' + version_in;
var input_path = tmp_folder + input_name;
var entrada = ee.Image(input_path).select(bandNames);

// # Functions ----
var esNatural = function(img) {
  var m = img.eq(NAT[0]);
  NAT.slice(1).forEach(function(c) { m = m.or(img.eq(c)); });
  return m;
};

var conteosNat = function(img) {
  var v = img.unmask(0);
  var n = {};
  NAT.forEach(function(c) { n[c] = v.eq(c).reduce(ee.Reducer.sum()); });
  return n;
};

var modaNatural = function(img) {
  var v = img.unmask(0);
  var nat = esNatural(v);
  var n = conteosNat(img);
  var maxC = ee.Image.cat(NAT.map(function(c) { return n[c]; })).reduce(ee.Reducer.max());

  // Count-based mode; reverse iteration gives the first class in NAT priority in a tie
  var moda = ee.Image(0);
  NAT.slice().reverse().forEach(function(c) { moda = moda.where(n[c].eq(maxC), c); });

  // Prefer the most recent natural vegetation class if it is tied for the maximum count
  var ultima = ee.Image(0);
  for (var i = 0; i < nYears; i++) { ultima = ultima.where(nat.select(i), v.select(i)); }
  var conteoUltima = ee.Image(0);
  NAT.forEach(function(c) { conteoUltima = conteoUltima.where(ultima.eq(c), n[c]); });
  moda = moda.where(ultima.gt(0).and(conteoUltima.eq(maxC)), ultima);

  var aplicar = nat.and(maxC.gte(MIN_ANIOS_NAT));
  return img.where(aplicar, moda).rename(bandNames);
};

var salida = modaNatural(entrada);
var nCambios = entrada.neq(salida).reduce(ee.Reducer.sum()).rename('n_cambios');

// # Quality assurance and pixel inspector ----
var fmtSerie = function(vals) {
  return vals.map(function(v) {
    var s = (v === null || v === 0) ? '-' : String(v);
    return ('   ' + s).slice(-3);
  }).join('');
};
var encabezado = '          ' + years.map(function(y) { return ('   ' + String(y).slice(2)).slice(-3); }).join('');

if (RUN_QA) {
  var ptoQA = ee.Geometry.Point([-92, 17]);
  var qaSerie = function(titulo, serie) {
    var s = serie.slice(); while (s.length < nYears) { s.push(0); }
    var img = ee.Image.constant(s).rename(bandNames).int().selfMask();
    var stack = img.unmask(0).rename(bandNames.map(function(b) { return 'a_' + b; }))
      .addBands(modaNatural(img).unmask(0).rename(bandNames.map(function(b) { return 'b_' + b; })));
    stack.reduceRegion(ee.Reducer.first(), ptoQA, 30).evaluate(function(d) {
      print([titulo, encabezado,
        '  original' + fmtSerie(bandNames.map(function(b) { return d['a_' + b]; })),
        '      moda' + fmtSerie(bandNames.map(function(b) { return d['b_' + b]; }))].join('\n'));
    });
  };
  // 3 = tropical rain forest (BTH), 11 = wetland (I), 19 = agriculture (A)
  qaSerie('QA 1 - BTH BTH + I x13 -> todo 11',
    [3, 3, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11]);
  qaSerie('QA 2 - BTH BTH A A I x11 BTH BTH -> 11 11 19 19 11 ... 11',
    [3, 3, 19, 19, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 3, 3]);
  qaSerie('QA 3 - empate 3 x4 / 11 x4, el mas reciente es 3 -> todo 3',
    [11, 11, 11, 11, 3, 3, 3, 3, 15, 15]);
  qaSerie('QA 4 - sin naturales -> sin cambio',
    [15, 15, 19, 19, 24, 24]);
}

var inspeccionar = function(lon, lat) {
  var punto = ee.Geometry.Point([lon, lat]);
  var n = conteosNat(entrada);
  var stack = entrada.unmask(0).rename(bandNames.map(function(b) { return 'a_' + b; }))
    .addBands(salida.unmask(0).rename(bandNames.map(function(b) { return 'b_' + b; })))
    .addBands(ee.Image.cat(NAT.map(function(c) { return n[c].rename('n' + c); })));
  stack.reduceRegion(ee.Reducer.first(), punto, 30).evaluate(function(d) {
    if (!d) { print('Sin datos en el punto'); return; }
    var conteo = NAT.map(function(c) { return c + ':' + d['n' + c]; }).join('  ');
    print(['Pixel ' + lon.toFixed(5) + ', ' + lat.toFixed(5) + '  |  anios naturales  ' + conteo,
      encabezado,
      '   entrada' + fmtSerie(bandNames.map(function(b) { return d['a_' + b]; })),
      '      moda' + fmtSerie(bandNames.map(function(b) { return d['b_' + b]; }))].join('\n'));
  });
};
if (INSPECTOR) {
  Map.style().set('cursor', 'crosshair');
  Map.onClick(function(coords) { inspeccionar(coords.lon, coords.lat); });
}
if (PUNTO_INICIAL !== null) { inspeccionar(PUNTO_INICIAL[0], PUNTO_INICIAL[1]); }

// # Visualization ----
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');
var bandaVis = 'classification_' + yearInterest;

var mosaicos = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var mosaicoYear = mosaicos.filter(ee.Filter.eq('year', yearInterest)).mosaic();
var visMosaico = {bands: ['swir1_median', 'nir_median', 'red_median'], min: 0, max: 5615, gamma: 1};

if (SHOW_LAYERS) {
  Map.addLayer(mosaicoYear, visMosaico, 'Mosaico ' + yearInterest, true);
  Map.addLayer(entrada.select(bandaVis), vis, 'Entrada (tf6+urb) ' + yearInterest, false);
  Map.addLayer(salida.select(bandaVis), vis, 'Moda natural ' + yearInterest, true);
  Map.addLayer(nCambios.selfMask(), {min: 1, max: 15, palette: ['fff7bc', 'fe9929', '993404']},
               'Anios modificados por la moda', false);
}

// # Export ----
var out_name = country_name + '_' + region_name + '_' + name_x + '_arb_mgl_gf_tf3_tf6_urb_moda_v' + version_out;
print('Asset de salida', tmp_folder + out_name);
if (LAUNCH_EXPORTS) {
  Export.image.toAsset({
    image: salida.byte().set({paso: 'arb_mgl_gf_tf3_tf6_urb_moda', region: region_name, input: input_path,
                              anios: ANIO_INICIO + '-' + ANIO_FIN, clases_moda: NAT.join(','),
                              min_anios_nat: MIN_ANIOS_NAT}),
    description: out_name,
    assetId: tmp_folder + out_name,
    pyramidingPolicy: {'.default': 'mode'},
    region: entrada.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite: OVERWRITE
  });
}
