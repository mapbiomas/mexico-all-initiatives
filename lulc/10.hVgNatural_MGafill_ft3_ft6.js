// Regional pipeline: decision-tree harmonization -> mangrove -> gap filling -> 3-year filter
//   -> 6-year filter -> urban areas
// Version: 2026-10-07 (neighbor-mode gap filling and output asset overwriting)
// Period: ANIO_INICIO-ANIO_FIN (2000-2025; 26 bands). Outputs in COLLECTION-1/TMP, selected by EXPORTAR:
//   MEX_<reg>_<name>_arb_mgl_v1                     harmonization and mangrove (no gap filling)
//   MEX_<reg>_<name>_arb_mgl_gf_tf3_v1              gap filling and 3-year filter (no urban integration)
//   MEX_<reg>_<name>_arb_mgl_gf_tf3_tf6_v1          gap filling and 3- and 6-year filters (no urban integration)
//   MEX_<reg>_<name>_arb_mgl_gf_tf3_tf6_urb_v1      urban integration (final regional product)
//
// 1) Harmonization (resumen_arboles.md, 2026-10-01): calculate the proportions of classes
//    3, 66, 88, and 89 over PROP_INICIO-PROP_FIN. The regional decision tree selects one natural
//    vegetation class and assigns it to all years originally classified as 3, 66, 88, or 89.
// 2) Mangrove (MANGROVE_PATH; mangrove_YYYY bands): first mask residual classes 5 and 24
//    in the classification so gap filling can replace them. Then assign class 5 wherever
//    the annual mangrove layer is nonzero, following the rule in deprecated/11.GapFill.js.
// 3) Gap filling (GAPFILL): 'moda_vecinos' uses the most frequent class in the two years
//    on either side of each gap (ties favor later years). 'invertido' fills from the next valid year, then the previous one.
// 4) 3-year filter: apply window3y from the original 7.Temporal script to ANIO_INICIO-ANIO_FIN (classification only).
// 5) 6-year filter: replace A A B B A A with A A A A A A, comparing MapBiomas class codes.
// 6) Urban areas (URBAN_PATH; classification_YYYY bands): assign class 24 where the annual urban layer is nonzero.
//    Reapply mangrove (5) afterward to preserve the thematic priority
//    (mangrove > urban > other classes) and restore mangrove values affected by filtering.
// Process the full multiband image with image operations to keep the computation graph compact.

// # Configuration ----
var country_name = 'MEX';
var region_name = 5;
var name_x = 'alequech';
var class_version_in = '1';
var version_out = '1';

var ANIO_INICIO = 2000;       // Period to process and export
var ANIO_FIN = 2025;
var PROP_INICIO = 2000;       // Period used to calculate decision-tree proportions (must match calibration)
var PROP_FIN = 2025;
var yearInterest = 2011;

var URBAN_PATH    = 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/classification-ft/urban_temporal_filter4_1985_2025_v1';
var MANGROVE_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/mangrove/MEX_mangrove_only_v2';
var URBAN_PREFIX = 'classification_';
var MANGROVE_PREFIX = 'mangrove_';
var URBAN_VALUE_OUT = 24;
var MANGROVE_VALUE_OUT = 5;

var GAPFILL = 'moda_vecinos';  // 'moda_vecinos': mode of two years on either side of a gap; 'invertido': backward-first filling
var OVERWRITE = true;          // true: overwrite the output asset if it already exists
var LAUNCH_EXPORTS = true;
var EXPORTAR = ['arb_mgl_gf_tf3', 'arb_mgl_gf_tf3_tf6', 'arb_mgl_gf_tf3_tf6_urb'];   // Output stages to export to TMP
var SHOW_LAYERS = true;       // Set to false to reduce browser rendering load
var RUN_QA = false;           // Run tests on synthetic time series rather than real pixels
var INSPECTOR = true;         // Click the map to print the pixel time series at each processing stage
var PUNTO_INICIAL = null;     // Optional point to inspect on load: [longitude, latitude], e.g. [-92.5, 17.2]

var class_folder_in = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var tmp_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/TMP/';

// No further configuration is required below this line. -----

var years = [];
for (var y = ANIO_INICIO; y <= ANIO_FIN; y++) { years.push(y); }
var nYears = years.length;
var bandNames = years.map(function(y) { return 'classification_' + y; });


var input_path = class_folder_in + country_name + '_classification_' + region_name + '_' +
                 name_x + '_v' + class_version_in;
var asset = ee.Image(input_path);
var classification = asset.select(bandNames);

// # Functions ----
// ## Decision-tree harmonization of natural vegetation (proportions of classes 3, 66, 88, and 89)
var NAT4 = [3, 66, 88, 89];
var proporciones = function(img) {
  var v = img.unmask(0);
  var n = {};
  NAT4.forEach(function(c) { n[c] = v.eq(c).reduce(ee.Reducer.sum()); });
  var total = n[3].add(n[66]).add(n[88]).add(n[89]);
  var div = total.max(1);
  return {
    p3: n[3].divide(div), p66: n[66].divide(div), p88: n[88].divide(div), p89: n[89].divide(div),
    total: total
  };
};
// Decision trees from resumen_arboles.md: each function returns a class image. Apply where()
// from the last leaf to the first to reproduce a top-down traversal of the tree.
var ARBOLES = {
  1: function(p) {
    var clase89 = ee.Image(89).where(p.p88.gte(0.445054945), 88);
    return clase89.where(p.p89.lt(0.01923077), 66).where(p.p66.gte(0.110323888), 66);
  },
  2: function(p) {
    var bajo88 = ee.Image(88).where(p.p89.gte(0.93376065), 89);
    return bajo88.where(p.p88.gte(0.155870445), 88).where(p.p66.gte(0.980769215), 66);
  },
  3: function(p) {
    var alto89 = ee.Image(89).where(p.p66.gte(0.139610395), 66);
    return alto89.where(p.p89.lt(0.09109731), 88).where(p.p66.gte(0.844129565), 66);
  },
  4: function(p) {
    var alto3 = ee.Image(3).where(p.p88.gte(0.01923077), 88);
    return ee.Image(89).where(p.p3.gte(0.61204012), alto3).where(p.p88.gte(0.158947365), 88);
  },
  5: function(p) {
    var bajo3 = ee.Image(89).where(p.p3.gte(0.09761905), 3).where(p.p88.gte(0.204166665), 88);
    var alto3 = ee.Image(3).where(p.p88.gte(0.01923077), 88);
    return bajo3.where(p.p3.gte(0.5857843), alto3);
  }
};
var armonizarNatural = function(img, imgProp) {
  var p = proporciones(imgProp);
  var clase = ARBOLES[region_name](p);
  var esNat = img.eq(3).or(img.eq(66)).or(img.eq(88)).or(img.eq(89));
  return img.where(esNat.and(p.total.gt(0)), clase).rename(bandNames);
};

// ## Thematic layers: mangrove and urban areas (one band per year; nonzero values indicate presence)
var capaAnual = function(path, prefijo) {
  return ee.Image(path).select(years.map(function(y) { return prefijo + y; }))
    .unmask(0).neq(0).rename(bandNames);
};
var manglar = capaAnual(MANGROVE_PATH, MANGROVE_PREFIX);
var urbano = capaAnual(URBAN_PATH, URBAN_PREFIX);

// Mask residual classes 5 and 24 for gap filling, then apply the annual mangrove layer
var integrarManglar = function(img) {
  var limpia = img.updateMask(img.neq(URBAN_VALUE_OUT).and(img.neq(MANGROVE_VALUE_OUT)));
  // where() preserves the mask; unmask() also writes mangrove into years without data
  var capa5 = manglar.multiply(MANGROVE_VALUE_OUT).selfMask();
  return limpia.where(manglar, MANGROVE_VALUE_OUT).unmask(capa5).rename(bandNames);
};
// Apply urban areas first, then mangrove to preserve the thematic priority
var integrarUrbano = function(img) {
  return img.where(urbano, URBAN_VALUE_OUT).where(manglar, MANGROVE_VALUE_OUT).rename(bandNames);
};

// ## Backward-first gap filling (nYears - 1 backward unmask operations, then forward filling)
var fillBackward = function(img) {
  var bands = new Array(nYears);
  bands[nYears - 1] = img.select(nYears - 1);
  for (var i = nYears - 2; i >= 0; i--) { bands[i] = img.select(i).unmask(bands[i + 1]); }
  return ee.Image.cat(bands).rename(bandNames);
};
var fillForward = function(img) {
  var bands = [img.select(0)];
  for (var i = 1; i < nYears; i++) { bands.push(img.select(i).unmask(bands[i - 1])); }
  return ee.Image.cat(bands).rename(bandNames);
};
var gapfillInvertido = function(img) {
  return fillForward(fillBackward(img.selfMask()));
};

// ## Fill gaps using the most frequent class in the two years on either side
// A gap is a run of consecutive years without data; the entire run receives one class.
// Use the two years before the gap (L1 = immediately before, L2 = one year earlier) and
// the two years after it (R1 = immediately after, R2 = one year later), using original values.
// Missing or out-of-range years contribute no votes. Select the most frequent class;
// break ties in the order R1, R2, L1, L2. Pixels with no valid observations remain masked.
// Scan forward to carry the last valid value (L1) and the original value from the year
// immediately before it (L2). Scan backward to carry the next valid value (R1) and the
// original value immediately after it (R2). Use band operations without image collections.
var gapfillModaVecinos = function(img) {
  var n = nYears;
  var cero = ee.Image(0).rename('v');
  var b = [], ok = [];
  for (var k = 0; k < n; k++) {
    b.push(img.select(k).unmask(0).rename('v'));   // 0 = no data
    ok.push(b[k].neq(0));
  }
  var L1 = [], L2 = [], R1 = new Array(n), R2 = new Array(n);
  var a = cero, c = cero;
  for (var t = 0; t < n; t++) {                     // Forward scan
    L1.push(a); L2.push(c);
    a = a.where(ok[t], b[t]);
    c = c.where(ok[t], t > 0 ? b[t - 1] : cero);
  }
  a = cero; c = cero;
  for (var t2 = n - 1; t2 >= 0; t2--) {             // Backward scan
    R1[t2] = a; R2[t2] = c;
    a = a.where(ok[t2], b[t2]);
    c = c.where(ok[t2], t2 < n - 1 ? b[t2 + 1] : cero);
  }
  var bandas = [];
  for (var t3 = 0; t3 < n; t3++) {
    var cand = [R1[t3], R2[t3], L1[t3], L2[t3]];    // Tie-breaking priority
    var conteo = cand.map(function(x) {
      var s = cero;
      cand.forEach(function(y) { s = s.add(y.eq(x)); });
      return s.multiply(x.neq(0));                  // Missing values contribute no votes
    });
    var elegido = cero, mejor = cero;
    for (var i = 0; i < 4; i++) {
      var gana = conteo[i].gt(mejor);               // Strict comparison preserves the earlier candidate in a tie
      elegido = elegido.where(gana, cand[i]);
      mejor = mejor.max(conteo[i]);
    }
    bandas.push(b[t3].where(ok[t3].not(), elegido));
  }
  return ee.Image.cat(bandas).rename(bandNames).selfMask();
};

// Select the gap-filling method configured by GAPFILL
var gapfill = function(img) {
  return GAPFILL === 'moda_vecinos' ? gapfillModaVecinos(img) : gapfillInvertido(img);
};


// ## 3-year temporal filter: original window3y from 7.Temporal, with probability processing disabled
// Interior years only (first and last are handled separately below)
var anos = ee.List.sequence(ANIO_INICIO + 1, ANIO_FIN - 1)
                  .map(function (y) {
                        return ee.Number(y).int(); });

var window3y = function (img, classe) {
                var classWindPre = ee.ImageCollection(anos.map(function (ano) {
                    ano = ee.Number(ano);
                    var anoStr = ano.format();
                    var nomeBanda = ee.String('classification_').cat(anoStr);

                    var class_Ano = img.select(nomeBanda);
                    var classPrev = img.select(ee.String('classification_').cat(ano.subtract(1).format()));
                    var classNext = img.select(ee.String('classification_').cat(ano.add(1).format()));

                    // 3-year window mask (boolean condition): class present only
                    // in the central year -> single-year flicker
                    var mask_3 = classNext.neq(classe)
                            .and(class_Ano.eq(classe))
                            .and(classPrev.neq(classe));

                    // mask_3 now carries the CLASS VALUE of the previous year,
                    // masked to the pixels meeting the window condition
                    mask_3 = classPrev.remap([88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34],
                                             [88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34]).updateMask(mask_3);

                    // Classification: replace the flicker with the previous year's class
                    var class_corr = class_Ano.blend(mask_3.rename(nomeBanda));
                    return class_corr;
                                                            }));

        var classWind = classWindPre.select('classification_.*').toBands();

        var n = anos.size();
        var ultimo = ee.Number(anos.get(n.subtract(1))).add(1);
        var primero = ee.Number(anos.get(0)).subtract(1);

        // Ensure the first and last years are included (passed through untouched)
        var class_pri = img.select([ee.String('classification_').cat(primero)],
                                        [ee.String('00_classification_').cat(primero)]);
        var class_ult = img.select([ee.String('classification_').cat(ultimo)],
                                        [ee.String('00_classification_').cat(ultimo)]);
        var class_final = class_pri.addBands(classWind).addBands(class_ult);

        // Strip the sort prefix ("00_") so band names return to classification_YYYY
        var corrIndx = function (img) {
              var indxNames = img.bandNames();
              var bandNames = indxNames.map(function (nome) {
                  return ee.String(nome).split('_').slice(1).join('_');
                                                          });
              return img.select(indxNames, bandNames);
            };
        return corrIndx(class_final);
};

// Apply the 3-year window filter sequentially to each class, as in the original script
var filtroTemporal3 = function(img) {
  var filtered = window3y(img,  88);
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
  return filtered;
};

// ## 6-year temporal filter: replace the two middle years (A A B B A A -> A A A A A A)
// Pad a band stack with 'antes' leading and 'despues' trailing zero bands to align it with nYears
var alinear = function(pila, antes, despues) {
  var ceros = function(n) { var a = []; for (var i = 0; i < n; i++) { a.push(ee.Image(0)); } return a; };
  return ee.Image.cat(ceros(antes).concat([pila]).concat(ceros(despues)));
};
var filtroTemporal6 = function(img) {
  var g = img.unmask(0);                      // MapBiomas class codes; 0 = no data
  var n = nYears - 5;                         // Number of windows (start index s = 0..nYears-6)
  var gs = function(k) { return g.slice(k, k + n); };
  var cond = gs(0).eq(gs(1)).and(gs(4).eq(gs(1))).and(gs(5).eq(gs(1)))   // A A . . A A
    .and(gs(2).eq(gs(3))).and(gs(2).neq(gs(1)))                          // B B, B != A
    .and(gs(1).gt(0)).and(gs(2).gt(0));
  var valor = img.slice(1, 1 + n);            // Class code for year s+1 (the year before the two middle years)
  return img
    .where(alinear(cond, 2, 3), alinear(valor, 2, 3))    // Year s+2
    .where(alinear(cond, 3, 2), alinear(valor, 3, 2))    // Year s+3
    .rename(bandNames);
};

// # Outputs ----
var aniosProp = [];
for (var yp = PROP_INICIO; yp <= PROP_FIN; yp++) { aniosProp.push('classification_' + yp); }
var arb = armonizarNatural(classification, asset.select(aniosProp));
var arbMgl = integrarManglar(arb);
var gf = gapfill(arbMgl);
var gfTf3 = filtroTemporal3(gf);
var gfTf6 = filtroTemporal6(gfTf3);
var final = integrarUrbano(gfTf6);
var SALIDAS = [
  ['arb_mgl', arbMgl],
  ['arb_mgl_gf_tf3', gfTf3],
  ['arb_mgl_gf_tf3_tf6', gfTf6],
  ['arb_mgl_gf_tf3_tf6_urb', final]
];

// # Quality assurance and pixel inspector ----
// Format nYears values as aligned text ('-' = no data)
var fmtSerie = function(vals) {
  return vals.map(function(v) {
    var s = (v === null || v === 0) ? '-' : String(v);
    return ('   ' + s).slice(-3);
  }).join('');
};
var encabezado = '              ' + years.map(function(y) { return ('   ' + String(y).slice(2)).slice(-3); }).join('');

// ## Synthetic time-series tests (constant images; the sample location is arbitrary)
// Each test prints the original series followed by the result of each function.
if (RUN_QA) {
  var ptoQA = ee.Geometry.Point([-92, 17]);
  var qaSerie = function(titulo, serie, pasos) {
    var s = serie.slice(); while (s.length < nYears) { s.push(0); }
    var img = ee.Image.constant(s).rename(bandNames).int();
    var capas = [['original', img]].concat(pasos.map(function(p) { return [p[0], p[1](img)]; }));
    var stack = ee.Image.cat(capas.map(function(c, i) {
      return c[1].unmask(0).rename(bandNames.map(function(b) { return 'c' + i + '_' + b; }));
    }));
    stack.reduceRegion(ee.Reducer.first(), ptoQA, 30).evaluate(function(d) {
      var lineas = [titulo, encabezado];
      capas.forEach(function(c, i) {
        var vals = bandNames.map(function(b) { return d['c' + i + '_' + b]; });
        lineas.push(('              ' + c[0]).slice(-14) + fmtSerie(vals));
      });
      print(lineas.join('\n'));
    });
  };
  qaSerie('QA 1 - arbol R' + region_name + ': 3 x10, 88 x2, 89 x2 -> esperado: todos los naturales a 88',
    [3, 89, 88, 3, 15, 0, 3, 3, 3, 88, 3, 3, 3, 3, 89, 3],
    [['arbol', function(i) { return armonizarNatural(i, i); }]]);
  qaSerie('QA 2 - invertido: huecos 04-06 toman 19 (2007); tf3 quita los 89 aislados',
    [19, 3, 3, 89, 0, 0, 0, 19, 3, 89, 3, 19],
    [['invertido', gapfillInvertido],
     ['invertido+tf3', function(i) { return filtroTemporal3(gapfillInvertido(i)); }]]);
  qaSerie('QA 4 - gapfill moda de vecinos: 2002->15, 2006->19 (el invertido pone 11), 2011->89 (empate 19x2/89x2, lado posterior), ' +
          '2014->89; hueco 2021-2023 -> 3 (3x3 vs 15x1; el invertido pone 15)',
    [15, 15, 0, 15, 19, 19, 0, 11, 19, 19, 19, 0, 89, 89, 0, 89, 3, 3, 3, 3, 3, 0, 0, 0, 15, 3],
    [['moda_vecinos', gapfillModaVecinos], ['invertido', gapfillInvertido]]);
  qaSerie('QA 3 - filtro 6 por clase MapBiomas: 15 15 entre 3 -> 3; 89 89 entre 3 -> 3; 15 15 entre 19 -> 19',
    [3, 3, 15, 15, 3, 3, 89, 89, 3, 3, 19, 19, 15, 15, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19],
    [['tf6', filtroTemporal6]]);
}

// ## Inspect real pixels by clicking the map
// Print the pixel's class proportions (3/66/88/89), decision-tree class, annual mangrove
// and urban presence, and time series at every stage, starting with the original classification.
var ETAPAS = [
  ['crudo', classification],
  ['arbol', arb],
  ['+manglar', arbMgl],
  ['gapfill', gf],
  ['gf+tf3', gfTf3],
  ['gf+tf3+tf6', gfTf6],
  ['+urbano', final]
];
var inspeccionar = function(lon, lat) {
  var punto = ee.Geometry.Point([lon, lat]);
  var p = proporciones(asset.select(aniosProp));
  var capas = ETAPAS.concat([['capa manglar', manglar], ['capa urbana', urbano]]);
  var stack = ee.Image.cat(capas.map(function(e, i) {
    return e[1].unmask(0).rename(bandNames.map(function(b) { return 'e' + i + '_' + b; }));
  })).addBands(ee.Image.cat([p.p3, p.p66, p.p88, p.p89, ARBOLES[region_name](p).updateMask(p.total.gt(0))])
    .rename(['p3', 'p66', 'p88', 'p89', 'clase_arbol']));
  stack.reduceRegion(ee.Reducer.first(), punto, 30).evaluate(function(d) {
    if (!d) { print('Sin datos en el punto'); return; }
    var r = function(x) { return x === null ? 'NA' : (Math.round(x * 1000) / 1000); };
    var lineas = [
      'Pixel ' + lon.toFixed(5) + ', ' + lat.toFixed(5) + '  |  proporciones ' + PROP_INICIO + '-' + PROP_FIN +
      ': p3=' + r(d.p3) + '  p66=' + r(d.p66) + '  p88=' + r(d.p88) + '  p89=' + r(d.p89) +
      '  ->  clase arbol: ' + (d.clase_arbol === null ? 'sin vegetacion natural' : d.clase_arbol),
      encabezado
    ];
    capas.forEach(function(e, i) {
      var vals = bandNames.map(function(b) { return d['e' + i + '_' + b]; });
      if (i === ETAPAS.length) { lineas.push(''); }
      lineas.push(('              ' + e[0]).slice(-14) + fmtSerie(vals));
    });
    print(lineas.join('\n'));
  });
};
if (INSPECTOR) {
  Map.style().set('cursor', 'crosshair');
  Map.onClick(function(coords) { inspeccionar(coords.lon, coords.lat); });
}
if (PUNTO_INICIAL !== null) { inspeccionar(PUNTO_INICIAL[0], PUNTO_INICIAL[1]); }

// # Visualization ----

// MapBiomas color palette
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');

var bandaVis = 'classification_' + yearInterest;

// ## Collection 1.0
var ASSET_V10 =
  'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/' +
  'MEX_integration_natstable_lagunas_ft_v1';
var version10 = ee.Image(ASSET_V10);

// ## MapBiomas Landsat mosaic
var mosaicos = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var mosaicoYear = mosaicos.filter(ee.Filter.eq('year', yearInterest)).mosaic();
var visMosaico = {bands: ['swir1_median', 'nir_median', 'red_median'], min: 0, max: 5615, gamma: 1};

if (SHOW_LAYERS) {
  Map.addLayer(mosaicoYear, visMosaico, 'Mosaico ' + yearInterest, true);
  Map.addLayer(version10.select(bandaVis), vis, 'Version 1.0 ' + yearInterest, false);
  Map.addLayer(classification.select(bandaVis), vis, 'Crudo ' + yearInterest, false);
  Map.addLayer(manglar.select(bandaVis).selfMask(), {palette: ['ff12a8']}, 'Capa manglar ' + yearInterest, false);
  Map.addLayer(urbano.select(bandaVis).selfMask(), {palette: ['d4271e']}, 'Capa urbana ' + yearInterest, false);
  SALIDAS.forEach(function(s, i) {
    Map.addLayer(s[1].select(bandaVis), vis, s[0] + ' ' + yearInterest, i === SALIDAS.length - 1);
  });
}

// # Export ----
SALIDAS.forEach(function(s) {
  if (EXPORTAR.indexOf(s[0]) < 0) { return; }
  var out_name = country_name + '_' + region_name + '_' + name_x + '_' + s[0] + '_v' + version_out;
  print('Asset de salida', tmp_folder + out_name);
  if (LAUNCH_EXPORTS) {
    Export.image.toAsset({
      image: s[1].byte().set({paso: s[0], region: region_name, input: input_path,
                              anios: ANIO_INICIO + '-' + ANIO_FIN, prop_anios: PROP_INICIO + '-' + PROP_FIN,
                              manglar: MANGROVE_PATH, urbano: URBAN_PATH, gapfill: GAPFILL}),
      description: out_name,
      assetId: tmp_folder + out_name,
      pyramidingPolicy: {'.default': 'mode'},
      region: classification.geometry().bounds(),
      scale: 30,
      maxPixels: 1e13,
      overwrite: OVERWRITE
    });
  }
});
