// Reconstruct the 1985-1999 series using the processed 2000-2025 reference (Region 5)
// Version: 2026-10-07 (neighbor-mode gap filling, asset overwriting, and ..._urb_moda_v1 reference)
//
// Inputs:
//   - Original MEX_classification_<reg>_<name>_v1 classification for 1985-1999.
//   - Processed 2000-2025 reference (REF_PATH): TMP/MEX_5_alequech_arb_mgl_gf_tf3_tf6_urb_moda_v1.
//     This reference supplies the temporal mode and the 2000-2025 segment of the output series.
//     Mask urban (24) and mangrove (5) during gap filling and temporal filtering to avoid propagating
//     urban cover backward from 2000. Restore both classes from their annual thematic layers afterward.
//
// Processing for 1985-1999:
// 1) Reference-based harmonization: calculate each pixel's 2000-2025 mode among classes
//    3, 66, 88, 89, and 11 (wetland). Replace historical observations of these classes with
//    the reference mode to harmonize natural vegetation types, including wetlands.
//    If the reference contains none of these classes, retain the original historical values.
//    Break ties in the order 3, 88, 89, 66, 11. Display tied pixels in the
//    'Empates moda 2000-2025' layer; EXPORT_EMPATES optionally exports tie diagnostics.
// 2) Mangrove (MANGROVE_PATH): mask residual classes 5 and 24 in the original classification;
//    assign class 5 wherever the annual mangrove layer is nonzero, as in the 2000-2025 pipeline.
// Then process the full 1985-2025 series (historical steps 1-2 plus the processed reference):
// 3) Gap filling (GAPFILL): 'moda_vecinos' uses the most frequent class in the two years
//    on either side of each gap (ties favor later years). 'invertido' fills from the next valid year, then the previous one.
// 4) 3-year filter: apply the original window3y from 7.Temporal to interior years 1986-2024.
// 5) 6-year filter: replace A A B B A A with A A A A A A using MapBiomas class codes.
// 6) Restore annual urban areas (24), then mangrove (5), across 1985-2025.
// Steps 4-6 also reprocess 2000-2025, which is already filtered. This allows harmonization
// across the 1999/2000 boundary; changes elsewhere are expected to be limited.

// # Configuration ----
var country_name = 'MEX';
var region_name = 5;
var name_x = 'alequech';
var class_version_in = '1';
var REF_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/TMP/MEX_5_alequech_arb_mgl_gf_tf3_tf6_urb_moda_v1';
var version_out = '1';

var ANIO_INICIO = 1985;       // Start of the complete output series
var ANIO_FIN = 2025;
var HIST_FIN = 1999;          // Reconstruct 1985-HIST_FIN; use the reference for HIST_FIN+1 through ANIO_FIN
var yearInterest = 1990;

var URBAN_PATH    = 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/classification-ft/urban_temporal_filter4_1985_2025_v1';
var MANGROVE_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/mangrove/MEX_mangrove_only_v2';
var URBAN_PREFIX = 'classification_';
var MANGROVE_PREFIX = 'mangrove_';
var URBAN_VALUE_OUT = 24;
var MANGROVE_VALUE_OUT = 5;

var NAT_REF = [3, 88, 89, 66, 11];   // Classes used for the 2000-2025 mode; order defines tie-breaking priority

var GAPFILL = 'moda_vecinos';  // 'moda_vecinos': mode of two years on either side of a gap; 'invertido': backward-first filling
var OVERWRITE = true;          // true: overwrite the output asset if it already exists
var LAUNCH_EXPORTS = false;
var EXPORTAR = ['8525_gf_tf3', '8525_gf_tf3_tf6', '8525_gf_tf3_tf6_urb'];
var EXPORT_EMPATES = false;   // Export tie diagnostics (moda_ref, n_empate, codigo_empate) to TMP
var SHOW_LAYERS = true;       // Set to false to reduce browser rendering load
var RUN_QA = false;           // Run tests on synthetic time series rather than real pixels
var INSPECTOR = true;         // Click the map to print the pixel time series at each processing stage
var PUNTO_INICIAL = null;     // Optional initial inspection point: [longitude, latitude]

var class_folder_in = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification/';
var tmp_folder = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/TMP/';

// No further configuration is required below this line. -----

var rango = function(a, b) { var r = []; for (var y = a; y <= b; y++) { r.push(y); } return r; };
var years = rango(ANIO_INICIO, ANIO_FIN);
var histYears = rango(ANIO_INICIO, HIST_FIN);
var refYears = rango(HIST_FIN + 1, ANIO_FIN);
var nYears = years.length;
var bn = function(ys) { return ys.map(function(y) { return 'classification_' + y; }); };
var bandNames = bn(years);

var input_path = class_folder_in + country_name + '_classification_' + region_name + '_' + name_x + '_v' + class_version_in;
var ref_path = REF_PATH;
var asset = ee.Image(input_path);
// Collection 1.0 reference for map and pixel-inspector comparisons
var ASSET_V10 = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/' +
                'MEX_integration_natstable_lagunas_ft_v1';
var version10 = ee.Image(ASSET_V10);
var refAsset = ee.Image(ref_path);

// Select annual bands; substitute a masked band (or zero for thematic layers) when a year is missing
var seleccionar = function(img, prefijo, ys, faltante) {
  var existentes = img.bandNames().getInfo();
  return ee.Image.cat(ys.map(function(y) {
    var b = prefijo + y;
    if (existentes.indexOf(b) === -1) {
      print('Aviso: falta ' + b + ' en ' + (img.get('system:id').getInfo() || 'imagen'));
      return faltante.rename('classification_' + y);
    }
    return img.select([b]).rename('classification_' + y);
  }));
};
var crudoHist = seleccionar(asset, 'classification_', histYears, ee.Image(0).selfMask().byte());
var crudoRef = seleccionar(asset, 'classification_', refYears, ee.Image(0).selfMask().byte());   // Used only by the pixel inspector
var ref = seleccionar(refAsset, 'classification_', refYears, ee.Image(0).selfMask().byte());

// # Functions ----
// ## Step 1: calculate the reference mode over NAT_REF and harmonize historical natural vegetation/wetland years
var modaNatural = function(img) {
  var v = img.unmask(0);
  var mejor = ee.Image(0);
  var clase = ee.Image(0);                      // 0 = no NAT_REF classes present in the reference
  NAT_REF.forEach(function(c) {
    var n = v.eq(c).reduce(ee.Reducer.sum());
    clase = clase.where(n.gt(mejor), c);        // Strict comparison preserves the earlier NAT_REF class in a tie
    mejor = mejor.max(n);
  });
  return clase.rename('moda_ref');
};
var moda = modaNatural(ref);

// ## Mode ties: pixels where two or more NAT_REF classes share the highest annual count
// n_empate      = number of tied classes (0 = no tie)
// codigo_empate = sum of class bits: 3=1, 88=2, 89=4, 66=8, 11=16
//                 Examples: 5 = classes 3 and 89; 17 = 3 and 11; 20 = 89 and 11
var BIT = {3: 1, 88: 2, 89: 4, 66: 8, 11: 16};
var empatesModa = function(img) {
  var v = img.unmask(0);
  var n = NAT_REF.map(function(c) { return v.eq(c).reduce(ee.Reducer.sum()); });
  var maximo = ee.Image(0);
  n.forEach(function(x) { maximo = maximo.max(x); });
  var cuenta = ee.Image(0), codigo = ee.Image(0);
  NAT_REF.forEach(function(c, i) {
    var empata = n[i].eq(maximo).and(maximo.gt(0));
    cuenta = cuenta.add(empata);
    codigo = codigo.add(empata.multiply(BIT[c]));
  });
  var hay = cuenta.gte(2);
  return ee.Image.cat([cuenta.multiply(hay), codigo.multiply(hay)]).rename(['n_empate', 'codigo_empate'])
    .addBands(ee.Image.cat(n).rename(NAT_REF.map(function(c) { return 'n' + c; })));
};
var empates = empatesModa(ref);
var esNatRef = function(img) {
  var m = img.eq(NAT_REF[0]);
  NAT_REF.slice(1).forEach(function(c) { m = m.or(img.eq(c)); });
  return m;
};
var paso1 = function(hist) {
  return hist.where(esNatRef(hist).and(moda.gt(0)), moda).rename(bn(histYears));
};

// ## Thematic layers: mangrove and urban areas (one band per year; nonzero values indicate presence)
var capaAnual = function(path, prefijo, ys) {
  return seleccionar(ee.Image(path), prefijo, ys, ee.Image(0).byte()).unmask(0).neq(0).rename(bn(ys));
};
var manglarHist = capaAnual(MANGROVE_PATH, MANGROVE_PREFIX, histYears);
var manglar = capaAnual(MANGROVE_PATH, MANGROVE_PREFIX, years);
var urbano = capaAnual(URBAN_PATH, URBAN_PREFIX, years);

// ## Step 2: mask residual classes 5 and 24, then apply annual mangrove cover (1985-1999)
var integrarManglar = function(img, capa) {
  var limpia = img.updateMask(img.neq(URBAN_VALUE_OUT).and(img.neq(MANGROVE_VALUE_OUT)));
  var capa5 = capa.multiply(MANGROVE_VALUE_OUT).selfMask();
  return limpia.where(capa, MANGROVE_VALUE_OUT).unmask(capa5);
};
// ## Step 6: apply urban areas first, then mangrove to preserve the thematic priority
var integrarUrbano = function(img) {
  return img.where(urbano, URBAN_VALUE_OUT).where(manglar, MANGROVE_VALUE_OUT).rename(bandNames);
};

// ## Step 3: backward-first gap filling, followed by forward filling
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


// ## Step 4: original 3-year window3y filter from 7.Temporal, with probability processing disabled
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

                    var mask_3 = classNext.neq(classe)
                            .and(class_Ano.eq(classe))
                            .and(classPrev.neq(classe));

                    mask_3 = classPrev.remap([88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34],
                                             [88,89,3,5,66,45,11,15,36,19,9,21,24,25,33,34]).updateMask(mask_3);

                    var class_corr = class_Ano.blend(mask_3.rename(nomeBanda));
                    return class_corr;
                                                            }));

        var classWind = classWindPre.select('classification_.*').toBands();

        var n = anos.size();
        var ultimo = ee.Number(anos.get(n.subtract(1))).add(1);
        var primero = ee.Number(anos.get(0)).subtract(1);

        var class_pri = img.select([ee.String('classification_').cat(primero)],
                                        [ee.String('00_classification_').cat(primero)]);
        var class_ult = img.select([ee.String('classification_').cat(ultimo)],
                                        [ee.String('00_classification_').cat(ultimo)]);
        var class_final = class_pri.addBands(classWind).addBands(class_ult);

        var corrIndx = function (img) {
              var indxNames = img.bandNames();
              var bandNames = indxNames.map(function (nome) {
                  return ee.String(nome).split('_').slice(1).join('_');
                                                          });
              return img.select(indxNames, bandNames);
            };
        return corrIndx(class_final);
};

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

// ## Step 5: 6-year filter replaces the two middle years (A A B B A A -> A A A A A A)
var alinear = function(pila, antes, despues) {
  var ceros = function(n) { var a = []; for (var i = 0; i < n; i++) { a.push(ee.Image(0)); } return a; };
  return ee.Image.cat(ceros(antes).concat([pila]).concat(ceros(despues)));
};
var filtroTemporal6 = function(img) {
  var g = img.unmask(0);
  var n = nYears - 5;
  var gs = function(k) { return g.slice(k, k + n); };
  var cond = gs(0).eq(gs(1)).and(gs(4).eq(gs(1))).and(gs(5).eq(gs(1)))
    .and(gs(2).eq(gs(3))).and(gs(2).neq(gs(1)))
    .and(gs(1).gt(0)).and(gs(2).gt(0));
  var valor = img.slice(1, 1 + n);
  return img
    .where(alinear(cond, 2, 3), alinear(valor, 2, 3))
    .where(alinear(cond, 3, 2), alinear(valor, 3, 2))
    .rename(bandNames);
};

// # Outputs ----
var h1 = paso1(crudoHist);                                          // 1985-1999 after harmonization with the 2000-2025 mode
var h2 = integrarManglar(h1, manglarHist).rename(bn(histYears));    // Apply mangrove cover
// Mask reference classes 24 and 5 for gap filling/filtering; restore their annual thematic layers at the end
var refLimpia = ref.updateMask(ref.neq(URBAN_VALUE_OUT).and(ref.neq(MANGROVE_VALUE_OUT)));
var serie = ee.Image.cat([h2, refLimpia]).rename(bandNames);        // Complete 1985-2025 series before gap filling
var gf = gapfill(serie);
var gfTf3 = filtroTemporal3(gf);
var gfTf6 = filtroTemporal6(gfTf3);
var final = integrarUrbano(gfTf6);
var SALIDAS = [
  ['8525_mgl', serie],
  ['8525_gf_tf3', gfTf3],
  ['8525_gf_tf3_tf6', gfTf6],
  ['8525_gf_tf3_tf6_urb', final]
];

// # Quality assurance and pixel inspector ----
var fmtSerie = function(vals) {
  return vals.map(function(v) {
    var s = (v === null || v === undefined || v === 0) ? '-' : String(v);
    return ('   ' + s).slice(-3);
  }).join('');
};
var encabezado = '              ' + years.map(function(y) { return ('   ' + String(y).slice(2)).slice(-3); }).join('');

// ## Synthetic time-series tests (constant images; the sample location is arbitrary)
if (RUN_QA) {
  var ptoQA = ee.Geometry.Point([-92, 17]);
  var qaSerie = function(titulo, histVals, refVals) {
    var hImg = ee.Image.constant(histVals).rename(bn(histYears)).int().selfMask();
    var rImg = ee.Image.constant(refVals).rename(bn(refYears)).int().selfMask();
    var mQA = modaNatural(rImg);
    var p1 = hImg.where(esNatRef(hImg).and(mQA.gt(0)), mQA).rename(bn(histYears));
    var s = ee.Image.cat([p1, rImg]).rename(bandNames);
    var g = gapfill(s), t3 = filtroTemporal3(g), t6 = filtroTemporal6(t3);
    var capas = [['original', ee.Image.cat([hImg, rImg]).rename(bandNames)], ['paso 1 moda', s],
                 ['gapfill', g], ['tf3', t3], ['tf6', t6]];
    var stack = ee.Image.cat(capas.map(function(c, i) {
      return c[1].unmask(0).rename(bandNames.map(function(b) { return 'c' + i + '_' + b; }));
    })).addBands(mQA);
    stack.reduceRegion(ee.Reducer.first(), ptoQA, 30).evaluate(function(d) {
      var lineas = [titulo + '   (moda 2000-2025: ' + d.moda_ref + ')', encabezado];
      capas.forEach(function(c, i) {
        lineas.push(('              ' + c[0]).slice(-14) + fmtSerie(bandNames.map(function(b) { return d['c' + i + '_' + b]; })));
      });
      print(lineas.join('\n'));
    });
  };
  var rep = function(v, k) { var a = []; for (var i = 0; i < k; i++) { a.push(v); } return a; };
  qaSerie('QA 1 - 1985-99 mezcla 89/3/11, referencia 3 -> todos los naturales a 3; el 15 15 de 1990-91 lo quita tf6',
    [89, 89, 3, 11, 89, 15, 15, 89, 3, 3, 89, 11, 3, 89, 89], rep(3, 26));
  qaSerie('QA 2 - referencia 89 con 11 11 en 2010-11 (moda 89) -> 1985-99 naturales e inundables a 89; huecos 89-90 toman 89; 19 19 19 se queda',
    [11, 11, 3, 3, 0, 0, 89, 19, 19, 19, 3, 3, 11, 3, 3], rep(89, 10).concat([11, 11]).concat(rep(89, 14)));
  qaSerie('QA 4 - EMPATE en la referencia: 13 anios 89 y 13 anios 3 -> gana 3 por prioridad (el pixel sale en la capa de empates)',
    [89, 89, 89, 89, 89, 89, 89, 89, 89, 89, 89, 89, 89, 89, 89], rep(89, 13).concat(rep(3, 13)));
  qaSerie('QA 3 - referencia sin vegetacion natural (siempre 15) -> 1985-99 sin reemplazo; tf3 quita el 89 aislado; huecos 1997-99 toman 15 (2000)',
    [3, 3, 3, 89, 3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0], rep(15, 26));
}

// ## Real-pixel inspector
var ETAPAS = [
  ['crudo', ee.Image.cat([crudoHist, crudoRef]).rename(bandNames)],
  ['ref 2000-25', ee.Image.cat([crudoHist.multiply(0).selfMask(), ref]).rename(bandNames)],
  ['paso1+mgl', serie],
  ['gapfill', gf],
  ['gf+tf3', gfTf3],
  ['gf+tf3+tf6', gfTf6],
  ['+urbano', final]
];
var EXTRA_INSPECTOR = [['Version 1.0', seleccionar(version10, 'classification_', years, ee.Image(0).selfMask().byte())]];
var inspeccionar = function(lon, lat) {
  var punto = ee.Geometry.Point([lon, lat]);
  var capas = ETAPAS.concat(EXTRA_INSPECTOR).concat([['capa manglar', manglar], ['capa urbana', urbano]]);
  var stack = ee.Image.cat(capas.map(function(e, i) {
    return e[1].unmask(0).rename(bandNames.map(function(b) { return 'e' + i + '_' + b; }));
  })).addBands(moda).addBands(empates);
  stack.reduceRegion(ee.Reducer.first(), punto, 30).evaluate(function(d) {
    if (!d) { print('Sin datos en el punto'); return; }
    var conteo = NAT_REF.map(function(c) { return c + ':' + d['n' + c]; }).join('  ');
    var lineas = [
      'Pixel ' + lon.toFixed(5) + ', ' + lat.toFixed(5) + '  |  moda 2000-2025 (3/88/89/66/11): ' +
      (d.moda_ref ? d.moda_ref : 'sin vegetacion natural -> 1985-' + HIST_FIN + ' sin reemplazo') +
      '  |  anios por clase: ' + conteo +
      (d.n_empate >= 2 ? '  |  EMPATE entre ' + d.n_empate + ' clases (codigo ' + d.codigo_empate + ')' : ''),
      encabezado
    ];
    capas.forEach(function(e, i) {
      var vals = bandNames.map(function(b) { return d['e' + i + '_' + b]; });
      if (i === ETAPAS.length || i === ETAPAS.length + EXTRA_INSPECTOR.length) { lineas.push(''); }
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
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');
var bandaVis = 'classification_' + yearInterest;
var mosaicos = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var mosaicoYear = mosaicos.filter(ee.Filter.eq('year', yearInterest)).mosaic();
var visMosaico = {bands: ['swir1_median', 'nir_median', 'red_median'], min: 0, max: 5615, gamma: 1};

if (SHOW_LAYERS) {
  Map.addLayer(mosaicoYear, visMosaico, 'Mosaico ' + yearInterest, true);
  Map.addLayer(version10.select(bandaVis), vis, 'Version 1.0 ' + yearInterest, false);
  Map.addLayer(asset.select(bandaVis), vis, 'Crudo ' + yearInterest, false);
  Map.addLayer(moda.selfMask(), vis, 'Moda natural 2000-2025', false);
  Map.addLayer(empates.select('n_empate').selfMask(), {min: 2, max: 3, palette: ['ffd400', 'ff00ff']},
               'Empates moda 2000-2025 (amarillo 2 clases, magenta 3+)', true);
  Map.addLayer(empates.select('codigo_empate').selfMask().randomVisualizer(), {},
               'Empates por combinacion de clases (codigo_empate)', false);
  Map.addLayer(manglar.select(bandaVis).selfMask(), {palette: ['ff12a8']}, 'Capa manglar ' + yearInterest, false);
  Map.addLayer(urbano.select(bandaVis).selfMask(), {palette: ['d4271e']}, 'Capa urbana ' + yearInterest, false);
  SALIDAS.forEach(function(s, i) {
    Map.addLayer(s[1].select(bandaVis), vis, s[0] + ' ' + yearInterest, i === SALIDAS.length - 1);
  });
}

// # Export ----
if (EXPORT_EMPATES) {
  var nombreEmp = country_name + '_' + region_name + '_' + name_x + '_empates_moda_2000_2025_v' + version_out;
  print('Asset de empates', tmp_folder + nombreEmp);
  Export.image.toAsset({
    image: moda.addBands(empates.select(['n_empate', 'codigo_empate'])).byte()
      .set({referencia: ref_path, clases: NAT_REF.join(','), bits: '3=1,88=2,89=4,66=8,11=16'}),
    description: nombreEmp, assetId: tmp_folder + nombreEmp,
    pyramidingPolicy: {'.default': 'mode'}, region: asset.geometry().bounds(), scale: 30, maxPixels: 1e13,
    overwrite: OVERWRITE
  });
}
SALIDAS.forEach(function(s) {
  if (EXPORTAR.indexOf(s[0]) < 0) { return; }
  var out_name = country_name + '_' + region_name + '_' + name_x + '_' + s[0] + '_v' + version_out;
  print('Asset de salida', tmp_folder + out_name);
  if (LAUNCH_EXPORTS) {
    Export.image.toAsset({
      image: s[1].byte().set({paso: s[0], region: region_name, input: input_path, referencia: ref_path,
                              anios: ANIO_INICIO + '-' + ANIO_FIN, hist: ANIO_INICIO + '-' + HIST_FIN,
                              manglar: MANGROVE_PATH, urbano: URBAN_PATH, gapfill: GAPFILL}),
      description: out_name,
      assetId: tmp_folder + out_name,
      pyramidingPolicy: {'.default': 'mode'},
      region: asset.geometry().bounds(),
      scale: 30,
      maxPixels: 1e13,
      overwrite: OVERWRITE
    });
  }
});
