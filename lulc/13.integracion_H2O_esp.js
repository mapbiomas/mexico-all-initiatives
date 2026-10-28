// MapBiomas Mexico Collection 1.1 national integration
// Version: 2026-10-15 (reclassify ice/snow below COTA_HIELO using SRTM before spatial filtering)
// Previous: 2026-10-14e (clip to valid C1.0 classes; mask() alone did not exclude unmasked ocean zeros)
// Previous: 2026-10-14d (protect water from spatial filtering; fill gaps using C1.0)
// Previous: 2026-10-14c (final clipping using CLIP_PATH)
// Previous: 2026-10-14b (require H2O for export; accept an Image or ImageCollection;
//   H2O_VALOR = null accepts nonzero values; add value and gap-filling diagnostics)
//
// Processing order:
// 1) Resolve urban/mangrove conflicts in each original regional image before integration:
//    wherever the annual mangrove layer (MANGROVE_PATH; mangrove_YYYY != 0) indicates
//    mangrove and the regional class is urban (24), assign mangrove (5).
// 2) Integrate the five Collection 1.1 regions (REGIONES), using only pixels within each
//    unbuffered polygon (provincias_fisiograficas_mexico; Region field). Rasterize region IDs
//    and apply where(), without clip()/blend(). Use default nearest-neighbor sampling
//    and export on the GRID_PATH grid (crs and crsTransform).
// 3) Mask values outside CLASES_VALIDAS.
// 4) Fill masked pixels with water (33) where the H2O layer matches H2O_VALOR (or is nonzero if null).
// 4b) Reclassify ice/snow (34) below COTA_HIELO meters above sea level (SRTM) as non-vegetated (25).
//    Apply this rule before spatial filtering and after C1.0 gap filling, which may reintroduce class 34.
// 5) Spatial filter (based on the original 8.SpatialFilter, without probability processing):
//    replace patches of <= FILTER_SIZE pixels (4-connected) with the 3x3 focal mode.
//    Treat masked values as zero, allowing small gaps to fill, then mask remaining zeros.
// 5b) If RELLENO_C10 is enabled, fill remaining gaps with valid classes from the same year
//    in C1.0, including gaps outside regional polygons or along the coast.
//    The spatial filter preserves CLASES_PROTEGIDAS (water, 33, by default) to retain narrow rivers.
// 6) Before export, restrict both outputs to CLIP_PATH using updateMask(). For image references,
//    retain pixels with a valid class in any year; for FeatureCollections, retain their polygons.
//    Use the reference bounding rectangle as the export region.
//
// Outputs (classification-ft/), both with optional C1.0 gap filling and final clipping:
//   MEX_integration_alequech_1_1_h2o_v1   integrated water and elevation correction, before spatial filtering
//   MEX_integration_alequech_1_1_ft_v1    final Collection 1.1 product, including spatial filtering

// # Configuration ----
var ANIO_INICIO = 1985;
var ANIO_FIN = 2025;
var yearInterest = 1987;

var TMP = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/TMP/';
// Regional Collection 1.1 outputs: tree/mode harmonization + historical reconstruction + gap filling + tf3 + tf6 + urban
var REGIONES = {
  1: TMP + 'MEX_1_alequech_8525_gf_tf3_tf6_urb_v1',
  2: TMP + 'MEX_2_alequech_8525_gf_tf3_tf6_urb_v1',
  3: TMP + 'MEX_3_alequech_8525_gf_tf3_tf6_urb_v1',
  4: TMP + 'MEX_4_alequech_8525_gf_tf3_tf6_urb_v1',
  5: TMP + 'MEX_5_alequech_8525_gf_tf3_tf6_urb_v2'    // v2 = neighbor-mode gap filling; v1 = backward-first gap filling
};
var BAND_PREFIX = 'classification_';
var REGIONS_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/provincias_fisiograficas_mexico';

var MANGROVE_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/mangrove/MEX_mangrove_only_v2';
var MANGROVE_PREFIX = 'mangrove_';
var URBANO = 24;
var MANGLAR = 5;

// 1.1 Temperate forest 88 | 1.2 Tropical dry forest 89 | 1.3 Tropical rain forest 3 | 1.4 Mangrove 5
// 2.1 Shrubland 66 | 2.2 Savanna and natural grassland 45 | 2.3 Wetland 11
// 3.1 Cultivated/induced pasture 15 | 3.2 Perennial crop 36 | 3.3 Annual crop 19 | 3.4 Forest plantation 9
// 4.1 Urban and built-up area 24 | 4.2 Other non-vegetated area 25
// 5.1 River, lake, or ocean 33 | 5.2 Permanent ice and snow 34
var CLASES_VALIDAS = [88, 89, 3, 5, 66, 45, 11, 15, 36, 19, 9, 24, 25, 33, 34];

var H2O_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/H2O';            // H2O water-layer asset path (1 = water)
var H2O_PREFIX = '';          // Empty prefix: use one band for all years; otherwise specify an annual prefix, e.g. 'water_'
var H2O_VALOR = 1;            // null: treat any nonzero value as water
var AGUA = 33;

var DEM_PATH = 'USGS/SRTMGL1_003';   // SRTM 30 m DEM; 'elevation' band
var COTA_HIELO = 3000;        // Elevation threshold in meters above sea level; class 34 below this threshold becomes 25
var HIELO = 34;
var NO_VEGETADO = 25;

var FILTER_SIZE = 6;          // Patch-size threshold from the original 8.SpatialFilter
var CLASES_PROTEGIDAS = [33]; // Preserve water during spatial filtering: 1-2-pixel-wide rivers may form small
                              // 4-connected patches and otherwise disappear. Mangrove (5) remains subject to filtering.

var GRID_PATH = REGIONES[5];  // Output grid reference (crs and crsTransform)
var OUT_FOLDER = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var OUT_H2O = 'MEX_integration_alequech_1_1_h2o_v1';
var OUT_FT = 'MEX_integration_alequech_1_1_ft_v1';
// Final clipping reference: Image with valid classes or FeatureCollection polygons; '' disables clipping
var CLIP_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/MEX_integration_natstable_lagunas_ft_v1';
var EXPORTAR = ['ft'];        // Export 'h2o', 'ft', or both
var LAUNCH_EXPORTS = true;
var OVERWRITE = true;
var SHOW_LAYERS = true;
var INSPECTOR = true;

var ASSET_V10 = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/MEX_integration_natstable_lagunas_ft_v1';
var RELLENO_C10 = true;       // Fill remaining gaps with valid values from the corresponding C1.0 year

// No further configuration is required below this line. -----

var years = [];
for (var y = ANIO_INICIO; y <= ANIO_FIN; y++) { years.push(y); }
var bandNames = years.map(function(yr) { return BAND_PREFIX + yr; });
var codigosRegion = Object.keys(REGIONES).map(Number);

// ## Check input assets
codigosRegion.forEach(function(r) {
  try { ee.data.getAsset(REGIONES[r]); print('Region ' + r + ' 1.1', REGIONES[r]); }
  catch (e) { print('FALTA el asset de la region ' + r, REGIONES[r]); }
});
if (!H2O_PATH) {
  if (LAUNCH_EXPORTS) { throw new Error('H2O_PATH vacio: sin la capa H2O el producto sale sin agua. Pega la ruta.'); }
  print('AVISO: H2O_PATH vacio; el paso 4 (agua) no se aplica.');
}

// ## Annual mangrove stack (missing years indicate no mangrove)
var mglImg = ee.Image(MANGROVE_PATH);
var mglBandas = mglImg.bandNames().getInfo();
var manglar = ee.Image.cat(years.map(function(yr) {
  var b = MANGROVE_PREFIX + yr;
  if (mglBandas.indexOf(b) === -1) { print('Manglar sin banda', b); return ee.Image(0).rename(BAND_PREFIX + yr); }
  return mglImg.select(b).unmask(0).neq(0).rename(BAND_PREFIX + yr);
}));

// # 1) Resolve urban/mangrove conflicts in each region ----
var conflictoTotal = ee.Image(0);
var regionales = {};
codigosRegion.forEach(function(r) {
  var img = ee.Image(REGIONES[r]).select(bandNames);
  var conflicto = img.eq(URBANO).and(manglar);
  regionales[r] = img.where(conflicto, MANGLAR);
  conflictoTotal = conflictoTotal.add(conflicto.reduce(ee.Reducer.sum()).unmask(0));
});

// # 2) Integrate using unbuffered regional polygons ----
var regionesFC = ee.FeatureCollection(REGIONS_PATH);
var regionId = ee.Image(0).paint(regionesFC, 'Region').rename('region');
var integ = ee.Image.constant(years.map(function() { return 0; })).rename(bandNames).toByte();
codigosRegion.forEach(function(r) {
  integ = integ.where(regionId.eq(r), regionales[r].unmask(0));
});
integ = integ.selfMask();   // Mask zeros outside regions or where data are missing

// # 3) Retain valid classes ----
// Compare each class with eq() because remap() processes only one band
var enLista = function(img, lista) {
  var m = img.eq(lista[0]);
  lista.slice(1).forEach(function(c) { m = m.or(img.eq(c)); });
  return m;
};
var esValido = function(img) { return enLista(img, CLASES_VALIDAS); };
var noValidos = integ.unmask(0).neq(0).and(esValido(integ.unmask(0)).not());
var nNoValidos = noValidos.reduce(ee.Reducer.sum()).rename('n_no_validos');
var integValida = integ.updateMask(esValido(integ));

// # 4) Fill gaps with H2O water ----
var conAgua = integValida;
var aguaAgregada = ee.Image(0);
if (H2O_PATH) {
  // Accept an Image or mosaic an ImageCollection
  var tipoH2O = ee.data.getAsset(H2O_PATH).type;
  var h2oImg = (tipoH2O === 'IMAGE_COLLECTION') ? ee.ImageCollection(H2O_PATH).mosaic() : ee.Image(H2O_PATH);
  var h2oBandas = h2oImg.bandNames().getInfo();
  print('H2O', H2O_PATH, 'tipo ' + tipoH2O, 'bandas', h2oBandas);
  var esAgua = function(b) {
    var v = h2oImg.select(b).unmask(0);
    return (H2O_VALOR === null) ? v.neq(0) : v.eq(H2O_VALOR);
  };
  var h2o = ee.Image.cat(years.map(function(yr) {
    var b = H2O_PREFIX ? H2O_PREFIX + yr : h2oBandas[0];
    if (h2oBandas.indexOf(b) === -1) { print('H2O sin banda', b); return ee.Image(0).rename(BAND_PREFIX + yr); }
    return esAgua(b).rename(BAND_PREFIX + yr);
  }));
  var llenar = integValida.mask().not().and(h2o);
  conAgua = integValida.unmask(0).where(llenar, AGUA).selfMask();
  aguaAgregada = llenar.reduce(ee.Reducer.max());

  // ## Approximate diagnostics at 5 km: H2O values and pixels filled with class 33
  var bDiag = H2O_PREFIX ? H2O_PREFIX + yearInterest : h2oBandas[0];
  if (h2oBandas.indexOf(bDiag) !== -1) {
    h2oImg.select(bDiag).reduceRegion({reducer: ee.Reducer.frequencyHistogram(), geometry: ee.FeatureCollection(REGIONS_PATH).geometry().bounds(),
                                       scale: 5000, bestEffort: true, maxPixels: 1e9})
      .evaluate(function(d) { print('Valores de H2O (' + bDiag + ', muestra a 5 km). Debe aparecer ' + H2O_VALOR, d); });
  }
  llenar.select(BAND_PREFIX + yearInterest).rename('llenados').reduceRegion({reducer: ee.Reducer.sum(),
      geometry: ee.FeatureCollection(REGIONS_PATH).geometry().bounds(), scale: 5000, bestEffort: true, maxPixels: 1e9})
    .evaluate(function(d) { print('Celdas de 5 km llenadas con 33 en ' + yearInterest + ' (si es 0, H2O no aporta nada)', d); });
}
conAgua = conAgua.rename(bandNames).toByte();

// # 4b) Reclassify ice/snow (34) below COTA_HIELO as class 25 using SRTM ----
var dem = ee.Image(DEM_PATH).select('elevation');
var bajoCota = dem.lt(COTA_HIELO).unmask(1);   // Treat missing DEM values (outside SRTM coverage) as below the threshold
var reglaHielo = function(img) {
  var cambiar = img.unmask(0).eq(HIELO).and(bajoCota);
  return img.where(cambiar, NO_VEGETADO).rename(bandNames).toByte();
};
var hieloCambiado = conAgua.unmask(0).eq(HIELO).and(bajoCota).reduce(ee.Reducer.sum()).rename('n_hielo_a_25');
conAgua = reglaHielo(conAgua);

// # 5) Spatial filtering (based on the original 8.SpatialFilter) ----
var protegida = function(img) {
  if (CLASES_PROTEGIDAS.length === 0) { return ee.Image(0); }
  return enLista(img, CLASES_PROTEGIDAS);
};
var filtrado = ee.Image.cat(bandNames.map(function(b) {
  var c = conAgua.select(b).unmask(0);
  var moda = c.focal_mode({radius: 1, kernelType: 'square', units: 'pixels'});
  var conexiones = c.connectedPixelCount({maxSize: 100, eightConnected: false});
  var cambiar = conexiones.lte(FILTER_SIZE).and(protegida(c).not());
  var out = c.where(cambiar, moda);
  return out.updateMask(out.neq(0)).rename(b);
})).toByte();
var cambiosFiltro = conAgua.unmask(0).neq(filtrado.unmask(0)).reduce(ee.Reducer.sum()).rename('n_cambios_filtro');

// # 6) Build the CLIP_PATH reference mask ----
var clipMask = ee.Image(1);
// Apply the mask with updateMask(); zero indicates no data in the final map
var clipRegion = null;
if (CLIP_PATH) {
  var tipoClip = ee.data.getAsset(CLIP_PATH).type;
  if (tipoClip === 'TABLE') {
    var clipFC = ee.FeatureCollection(CLIP_PATH);
    clipMask = ee.Image(0).paint(clipFC, 1);
    clipRegion = clipFC.geometry().bounds();
  } else {
    var clipImg = (tipoClip === 'IMAGE_COLLECTION') ? ee.ImageCollection(CLIP_PATH).mosaic() : ee.Image(CLIP_PATH);
    // A valid C1.0 pixel has a CLASES_VALIDAS value in at least one year. mask() alone would
    // retain unmasked no-data zeros (e.g. ocean), potentially keeping the full bounding rectangle.
    clipMask = esValido(clipImg.select(BAND_PREFIX + '.*').unmask(0)).reduce(ee.Reducer.max());
    clipRegion = (tipoClip === 'IMAGE_COLLECTION') ? ee.ImageCollection(CLIP_PATH).geometry().bounds()
                                                   : clipImg.geometry().bounds();
  }
  print('Recorte con', CLIP_PATH, 'tipo ' + tipoClip);
}
// ## Fill remaining gaps with valid C1.0 observations from the corresponding year
// This restores coverage where regional data are missing, subject to the final clipping mask.
var rellenarC10 = function(img) {
  if (!RELLENO_C10) { return reglaHielo(img); }
  var c10 = ee.Image(ASSET_V10).select(bandNames);
  c10 = c10.updateMask(esValido(c10.unmask(0)));
  var hueco = img.mask().not().and(c10.mask());
  return reglaHielo(img.unmask(0).where(hueco, c10.unmask(0)).selfMask().rename(bandNames).toByte());
};
var conAguaRell = rellenarC10(conAgua);
var filtradoRell = rellenarC10(filtrado);
var rellenoC10 = filtrado.mask().not().and(filtradoRell.mask()).reduce(ee.Reducer.max());   // Pixels filled using C1.0 in at least one year

var conAguaClip = conAguaRell.updateMask(clipMask);
var filtradoClip = filtradoRell.updateMask(clipMask);
var fueraClip = filtradoRell.mask().reduce(ee.Reducer.max()).and(clipMask.not());   // Pixels excluded by the final clipping mask

// # Visualization ----
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');
var bandaVis = BAND_PREFIX + yearInterest;
var mosaicos = ee.ImageCollection('projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1');
var visMos = {bands: ['swir1_median', 'nir_median', 'red_median'], min: 0, max: 5615, gamma: 1};

if (SHOW_LAYERS) {
  Map.addLayer(mosaicos.filter(ee.Filter.eq('year', yearInterest)).mosaic(), visMos, 'Mosaico ' + yearInterest, false);
  Map.addLayer(ee.Image(ASSET_V10).select(bandaVis), vis, 'Version 1.0 ' + yearInterest, false);
  Map.addLayer(integ.select(bandaVis), vis, '2) Integrada ' + yearInterest, false);
  Map.addLayer(conAgua.select(bandaVis), vis, '3-4) Validos + H2O ' + yearInterest, false);
  Map.addLayer(filtradoClip.select(bandaVis), vis, '6) Final 1.1 (filtro + recorte) ' + yearInterest, true);
  Map.addLayer(fueraClip.selfMask(), {palette: ['ff0000']}, 'Quitado por el recorte', false);
  Map.addLayer(rellenoC10.selfMask(), {palette: ['ffa500']}, 'Rellenado con C1.0 (algun anio)', false);
  Map.addLayer(conflictoTotal.selfMask(), {min: 1, max: 20, palette: ['ffccff', 'cc00cc']}, 'Anios urbano -> manglar', false);
  Map.addLayer(nNoValidos.selfMask(), {min: 1, max: 20, palette: ['ffff99', 'ff6600']}, 'Anios con valor no valido -> null', false);
  Map.addLayer(hieloCambiado.selfMask(), {min: 1, max: 41, palette: ['d4b9da', '91003f']},
               'Anios 34 -> 25 (bajo ' + COTA_HIELO + ' m)', false);
  Map.addLayer(aguaAgregada.selfMask(), {palette: ['0000ff']}, 'Agua agregada por H2O (algun anio)', false);
  Map.addLayer(cambiosFiltro.selfMask(), {min: 1, max: 20, palette: ['c7e9c0', '006d2c']}, 'Anios cambiados por el filtro', false);
  Map.addLayer(ee.Image().byte().paint(regionesFC, 0, 1), {palette: ['000000']}, 'Regiones', true);
}

// ## Pixel inspector: time series at each processing stage
var fmt = function(vals) {
  return vals.map(function(v) { return ('   ' + (v === null || v === undefined || v === 0 ? '-' : v)).slice(-3); }).join('');
};
var encabezado = years.map(function(yr) { return ('   ' + String(yr).slice(2)).slice(-3); }).join('');
if (INSPECTOR) {
  Map.style().set('cursor', 'crosshair');
  Map.onClick(function(c) {
    var g = ee.Geometry.Point([c.lon, c.lat]);
    var ren = function(img, p) { return img.unmask(0).rename(bandNames.map(function(b) { return p + b; })); };
    ren(integ, 'i_').addBands(ren(conAgua, 'a_')).addBands(ren(filtrado, 'f_')).addBands(regionId)
      .reduceRegion(ee.Reducer.first(), g, 30).evaluate(function(d) {
        if (!d) { return; }
        var serie = function(p) { return fmt(bandNames.map(function(b) { return d[p + b]; })); };
        print(['Pixel ' + c.lon.toFixed(5) + ', ' + c.lat.toFixed(5) + ' | region ' + d.region,
               '            ' + encabezado,
               ' integrada  ' + serie('i_'),
               ' validos+H2O' + serie('a_'),
               ' filtro 1.1 ' + serie('f_')].join('\n'));
      });
  });
}

// # Export ----
var grid = ee.Image(GRID_PATH).projection().getInfo();
var region = clipRegion !== null ? clipRegion : regionesFC.geometry().bounds();
var exportar = function(img, nombre, paso) {
  print('Asset de salida', OUT_FOLDER + nombre);
  if (!LAUNCH_EXPORTS) { return; }
  Export.image.toAsset({
    image: img.set({version: '1.1', paso: paso, regiones: JSON.stringify(REGIONES), h2o: H2O_PATH,
                    clases_validas: CLASES_VALIDAS.join(','), filter_size: FILTER_SIZE, dem: DEM_PATH, cota_hielo: COTA_HIELO, clip: CLIP_PATH, relleno_c10: RELLENO_C10 ? ASSET_V10 : '', protegidas: CLASES_PROTEGIDAS.join(',')}),
    description: nombre,
    assetId: OUT_FOLDER + nombre,
    pyramidingPolicy: {'.default': 'mode'},
    region: region,
    crs: grid.crs,
    crsTransform: grid.transform,
    maxPixels: 1e13,
    overwrite: OVERWRITE
  });
};
if (EXPORTAR.indexOf('h2o') !== -1) { exportar(conAguaClip, OUT_H2O, 'manglar_integracion_validos_h2o'); }
if (EXPORTAR.indexOf('ft') !== -1) { exportar(filtradoClip, OUT_FT, 'manglar_integracion_validos_h2o_filtro_espacial'); }
