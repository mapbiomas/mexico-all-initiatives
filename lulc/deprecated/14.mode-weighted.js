// DEPRECATED: Part of the MapBiomas Mexico Collection 1.0 data flow; retained for historical reference.
// Versión script 20/07/2026
// Natural vegetation consolidation (mode-weighted)
// Input:  MEX_integration_alequech_gapfill_temporal_spatial_v1
// Output: MEX_integration_alequech_natstable_v1

// Description:
// For pixels dominated by natural vegetation (>= UMBRAL_NAT years in natural
// classes), replaces the yearly class with the mode-weighted class of the
// series (recent years weighted more heavily). Ties are left uncorrected.
// Click on the map to inspect the ORIGINAL vs CORRECTED pixel history 1985-2025.

// # User variables----
var ASSET_ID = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/' +
               'classification-ft/MEX_integration_alequech_gapfill_temporal_spatial_v1';

var BAND_PREFIX = 'classification_';
var DEFAULT_YEAR = 2024;

var years = [1985,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,
             2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,
             2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025];

// Consolidable natural classes (11 excluded)
var NAT_CONS = [88, 89, 3, 5, 66, 45];
// Recency weight: recent years count more toward the weighted mode
function pesoAnio(y) { if (y >= 2000) return 3; if (y >= 1996) return 2; return 1; }
// Minimum years in natural classes to be a consolidation candidate
var UMBRAL_NAT = 25;

var MOSAICS_ID = 'projects/mapbiomas-mosaics/assets/LANDSAT/LULC/MEXICO/mosaics-1';
var visLandsat = {bands: ['swir1_median', 'nir_median', 'red_median'], min: 0, max: 5615, gamma: 1};

// Do not need to move anything else from here on -----

// # Palette / legend data----
var Palette = require('users/mapbiomas-global/LULC:LULC_palette.js');
var vis = Palette.get('vis_LULC');
var paletteArr = vis.palette;

var legendData = [
  [88, 'Bosque Templado',              '1. Bosques'],
  [89, 'Bosque Tropical seco',         '1. Bosques'],
  [3,  'Bosque Tropical húmedo',       '1. Bosques'],
  [5,  'Manglar',                      '1. Bosques'],
  [66, 'Matorral',                     '2. Veget herbácea y arbustiva'],
  [45, 'Sabana y pastizal natural',    '2. Veget herbácea y arbustiva'],
  [11, 'Inundable',                    '2. Veget herbácea y arbustiva'],
  [15, 'Pastizal cultivado e inducido','3. Agropecuario'],
  [36, 'Cultivo perenne',              '3. Agropecuario'],
  [19, 'Cultivo anual',                '3. Agropecuario'],
  [9,  'Plantación forestal',          '3. Agropecuario'],
  [21, 'Mosaico de usos',              '3. Agropecuario'],
  [24, 'Área urbana y construída',     '4. No Vegetado'],
  [25, 'Área sin vegetación',          '4. No Vegetado'],
  [33, 'Río, lago y mar',              '5. Cuerpos de agua'],
  [34, 'Glaciar',                      '5. Cuerpos de agua'],
  [27, 'No observado',                 '6. No observado']
];
var classInfo = {};
legendData.forEach(function (r) { classInfo[r[0]] = {name: r[1], color: paletteArr[r[0]]}; });
function infoDe(v) {
  return (v !== null && v !== undefined && classInfo[v]) ? classInfo[v]
       : {name: (v === null || v === undefined ? 'Sin dato' : String(v)), color: 'white'};
}

// # Computation----
var asset  = ee.Image(ASSET_ID);
var bandas = years.map(function (y) { return BAND_PREFIX + y; });
var stack  = asset.select(bandas);
var pesosImg = ee.Image.constant(years.map(pesoAnio)).rename(bandas);

// Per-class weighted score -> weighted mode (argmax) + tie detection.
var scoreImgs = {};
NAT_CONS.forEach(function (c) {
  scoreImgs[c] = stack.eq(c).multiply(pesosImg).reduce(ee.Reducer.sum());
});
var scoreCol = ee.ImageCollection(NAT_CONS.map(function (c) { return scoreImgs[c].rename('score'); }));
var maxScore = scoreCol.max();
var nGanadoras = ee.ImageCollection(NAT_CONS.map(function (c) { return scoreImgs[c].eq(maxScore); })).sum();

var scored = NAT_CONS.map(function (c) {
  return scoreImgs[c].rename('score').addBands(ee.Image.constant(c).toUint8().rename('clase'));
});
var modaPond = ee.ImageCollection(scored).qualityMosaic('score').select('clase').rename('moda');

// Domain: years in natural classes and consolidation candidates (>= UMBRAL_NAT).
var aniosCons = ee.Image(0);
NAT_CONS.forEach(function (c) { aniosCons = aniosCons.add(stack.eq(c).reduce(ee.Reducer.sum())); });
var esCandidato = aniosCons.gte(UMBRAL_NAT);

// A real tie: more than one winning class among candidates -> leave uncorrected
var empateReal = nGanadoras.gt(1).and(esCandidato);

var modaPondVis = modaPond.updateMask(esCandidato);

// True if the pixel value belongs to a consolidable natural class
function esCons(img) {
  return ee.ImageCollection(NAT_CONS.map(function (c) { return img.eq(c); })).sum().gt(0);
}

// Corrected series (same logic as the filter): correct only candidates that are
// natural, differ from the weighted mode, and are not a real tie.
var bandasCorr = years.map(function (y) {
  var b = asset.select(BAND_PREFIX + y);
  var corregir = esCandidato.and(esCons(b)).and(b.neq(modaPond)).and(empateReal.not());
  return b.where(corregir, modaPond).rename(BAND_PREFIX + y);
});
var assetCorr = bandasCorr.reduce(function (prev, cur) { return prev.addBands(cur); });

// Number of false NAT<->NAT changes (QA diagnostic).
var nFalsos = ee.Image(0);
for (var i = 1; i < years.length; i++) {
  var pa = asset.select(BAND_PREFIX + years[i - 1]);
  var pb = asset.select(BAND_PREFIX + years[i]);
  nFalsos = nFalsos.add(esCons(pa).and(esCons(pb)).and(pa.neq(pb)));
}
nFalsos = nFalsos.selfMask();

// Single image bundling everything needed to sample a pixel in one click.
var oriSel = asset.select(bandas).rename(years.map(function (y) { return 'ori_' + y; }));
var corSel = assetCorr.select(bandas).rename(years.map(function (y) { return 'cor_' + y; }));
var sampleImg = oriSel.addBands(corSel)
                      .addBands(modaPond.rename('moda'))
                      .addBands(empateReal.rename('empate'))
                      .addBands(aniosCons.rename('anios_cons'));
NAT_CONS.forEach(function (c) { sampleImg = sampleImg.addBands(scoreImgs[c].rename('score_' + c)); });

var Land_collection = ee.ImageCollection(MOSAICS_ID);
var currentPoint = null;

// # Map----
Map.setCenter(-102, 23, 5);
Map.setOptions('HYBRID');
Map.style().set('cursor', 'crosshair');

function refreshLayers() {
  var year = Number(yearSelect.getValue());
  var landsat = Land_collection.filter(ee.Filter.eq('year', year)).mosaic();

  var layers = [
    ui.Map.Layer(nFalsos, {min: 1, max: 10, palette: ['yellow','orange','red']}, 'Nº falsos cambios NAT', false),
    ui.Map.Layer(empateReal.selfMask(), {palette: ['FFD700']}, 'Empate natural (sin corregir)', false),
    ui.Map.Layer(modaPondVis, vis, 'Moda ponderada NAT (solo dominio)', false),
    ui.Map.Layer(landsat, visLandsat, 'Landsat ' + year, landsatCheck.getValue()),
    ui.Map.Layer(asset.select(BAND_PREFIX + year), vis, 'Original ' + year, false),
    ui.Map.Layer(assetCorr.select(BAND_PREFIX + year), vis, 'Corregido ' + year, true)
  ];
  if (currentPoint) { layers.push(ui.Map.Layer(currentPoint, {color: 'FF0000'}, 'Pixel seleccionado')); }
  Map.layers().reset(layers);
}

// # Pixel history panel----
function resetHistoryPanel() {
  historyPanel.clear();
  historyPanel.add(ui.Label('Historia del pixel', {fontWeight: 'bold', margin: '0 0 2px 0'}));
  historyPanel.add(ui.Label('Haz clic en un pixel para ver original vs corregido.',
                            {fontSize: '11px', color: '#666', margin: '0 0 4px 0'}));
}

// Build a horizontal color strip (one cell per year) from a sampled object
function tira(obj, prefijo) {
  var strip = ui.Panel({layout: ui.Panel.Layout.Flow('horizontal'), style: {margin: '2px 0 0 0'}});
  years.forEach(function (y) {
    strip.add(ui.Label('', {backgroundColor: infoDe(obj[prefijo + y]).color,
                            width: '6px', height: '18px', margin: '0', padding: '0'}));
  });
  return strip;
}

function showHistory(point, coords) {
  historyPanel.clear();
  historyPanel.add(ui.Label('Historia del pixel', {fontWeight: 'bold', margin: '0 0 2px 0'}));
  historyPanel.add(ui.Label('Lon ' + coords.lon.toFixed(4) + ', Lat ' + coords.lat.toFixed(4),
                            {fontSize: '11px', color: '#666', margin: '0 0 4px 0'}));
  var loading = ui.Label('Cargando…', {fontSize: '11px', color: '#888'});
  historyPanel.add(loading);

  // Client-side sample of the bundled image at the clicked point
  sampleImg.reduceRegion({
    reducer: ee.Reducer.first(), geometry: point, scale: 30, maxPixels: 1e9
  }).evaluate(function (obj, err) {
    historyPanel.remove(loading);
    if (err) { historyPanel.add(ui.Label('Error: ' + err, {color: 'red', fontSize: '11px'})); return; }
    if (!obj) { historyPanel.add(ui.Label('Sin datos en este punto.', {fontSize: '11px'})); return; }

    // Original vs corrected color strips.
    historyPanel.add(ui.Label('Original', {fontSize: '10px', color: '#888', margin: '4px 0 0 0'}));
    historyPanel.add(tira(obj, 'ori_'));
    historyPanel.add(ui.Label('Corregido', {fontSize: '10px', color: '#888', margin: '4px 0 0 0'}));
    historyPanel.add(tira(obj, 'cor_'));
    historyPanel.add(ui.Label('1985  →  2025', {fontSize: '10px', color: '#888', margin: '0 0 6px 0'}));

    // Summary: distinguishes OUT OF DOMAIN vs TIE vs single winner.
    var scoresC = {}, maxS = 0;
    NAT_CONS.forEach(function (c) {
      var s = (obj['score_' + c] === undefined || obj['score_' + c] === null) ? 0 : obj['score_' + c];
      scoresC[c] = s; if (s > maxS) { maxS = s; }
    });
    var empatados = NAT_CONS.filter(function (c) { return maxS > 0 && scoresC[c] === maxS; });
    var candidato = (obj.anios_cons !== undefined && obj.anios_cons !== null &&
                     obj.anios_cons >= UMBRAL_NAT);

    var etiqueta, colorEtq;
    if (!candidato) {
      etiqueta = 'Fuera de dominio · no es vegetación natural dominante (' +
                 (obj.anios_cons === undefined ? 0 : obj.anios_cons) + '/' + years.length +
                 ' años). Serie original conservada, así debe ser.';
      colorEtq = '#777';
    } else if (empatados.length > 1) {
      etiqueta = 'Empate sin corregir entre ' +
                 empatados.map(function (c) { return classInfo[c].name + ' (' + c + ')'; }).join(' · ');
      colorEtq = '#b38f00';
    } else {
      etiqueta = 'Moda ponderada: ' + classInfo[empatados[0]].name + ' (' + empatados[0] + ')';
      colorEtq = '#225522';
    }

    var resumen = ui.Panel({style: {margin: '0 0 4px 0'}});
    resumen.add(ui.Label('Años en clases naturales: ' +
                         (obj.anios_cons === undefined ? '—' : obj.anios_cons) + ' / ' + years.length,
                         {fontSize: '11px', margin: '1px 0'}));
    resumen.add(ui.Label(etiqueta, {fontSize: '11px', fontWeight: 'bold', color: colorEtq, margin: '1px 0'}));
    if (candidato) {
      NAT_CONS.forEach(function (c) {
        resumen.add(ui.Panel([
          ui.Label('', {backgroundColor: classInfo[c].color, width: '11px', height: '11px',
                        margin: '1px 6px 1px 0', border: '1px solid #999'}),
          ui.Label(classInfo[c].name + ' (' + c + ') · peso ' + scoresC[c],
                   {fontSize: '10px', margin: '1px 0'})
        ], ui.Panel.Layout.Flow('horizontal')));
      });
    }
    historyPanel.add(resumen);

    // Year-by-year list: original -> corrected, flagging what the filter changed.
    var list = ui.Panel({style: {maxHeight: '210px'}});
    var prev = null;
    years.forEach(function (y) {
      var vo = obj['ori_' + y], vc = obj['cor_' + y];
      var io = infoDe(vo), ic = infoDe(vc);
      var cambioSerie = (vo !== prev);
      var corregido = (vo !== vc);

      var widgets = [
        ui.Label(String(y), {fontSize: '11px', width: '30px', margin: '1px 0',
                             fontWeight: cambioSerie ? 'bold' : 'normal'}),
        ui.Label('', {backgroundColor: io.color, width: '13px', height: '13px',
                      margin: '1px 4px 1px 0', border: '1px solid #999'}),
        ui.Label(vo === null || vo === undefined ? '—' : String(vo),
                 {fontSize: '11px', width: '24px', margin: '1px 0'})
      ];
      if (corregido) {
        widgets.push(ui.Label('→', {fontSize: '11px', margin: '1px 3px', color: '#b30000'}));
        widgets.push(ui.Label('', {backgroundColor: ic.color, width: '13px', height: '13px',
                                   margin: '1px 4px 1px 0', border: '1px solid #999'}));
        widgets.push(ui.Label(String(vc) + ' ' + ic.name,
                              {fontSize: '11px', color: '#b30000', fontWeight: 'bold', margin: '1px 0'}));
      } else {
        widgets.push(ui.Label(io.name, {fontSize: '11px', margin: '1px 0'}));
      }
      var row = ui.Panel(widgets, ui.Panel.Layout.Flow('horizontal'));
      if (corregido) { row.style().set('backgroundColor', 'rgba(255,220,220,0.6)'); }
      list.add(row);
      prev = vo;
    });
    historyPanel.add(list);
  });
}

Map.onClick(function (coords) {
  currentPoint = ee.Geometry.Point([coords.lon, coords.lat]);
  refreshLayers();
  showHistory(currentPoint, coords);
});

// # Controls----
var yearSelect = ui.Select({items: years.map(String), value: String(DEFAULT_YEAR),
                            onChange: refreshLayers, style: {width: '110px'}});
var landsatCheck = ui.Checkbox({label: 'Mostrar Landsat', value: false, onChange: refreshLayers});
var clearBtn = ui.Button({label: 'Limpiar selección', style: {margin: '6px 0 0 0'},
  onClick: function () { currentPoint = null; refreshLayers(); resetHistoryPanel(); }});

var controls = ui.Panel({style: {position: 'top-left', padding: '8px', width: '230px',
                                 backgroundColor: 'rgba(255,255,255,0.9)'}});
controls.add(ui.Label('Consolidación veg. natural', {fontWeight: 'bold', fontSize: '14px', margin: '0'}));
controls.add(ui.Label('Moda ponderada · original vs corregido',
                      {fontSize: '11px', color: '#666', margin: '0 0 6px 0'}));
controls.add(ui.Panel([ui.Label('Año:', {margin: '6px 6px 0 0'}), yearSelect], ui.Panel.Layout.Flow('horizontal')));
controls.add(landsatCheck);
controls.add(clearBtn);
controls.add(ui.Label('Haz clic en el mapa para ver la historia del pixel.',
                      {fontSize: '11px', color: '#444', margin: '6px 0 0 0'}));
Map.add(controls);

var historyPanel = ui.Panel({style: {position: 'top-right', padding: '8px', width: '320px',
                                     maxHeight: '520px', backgroundColor: 'rgba(255,255,255,0.92)'}});
Map.add(historyPanel);
resetHistoryPanel();

// # Legend----
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 15px',
                               backgroundColor: 'rgba(255,255,255,0.85)'}});
legend.add(ui.Label({value: 'Cubiertas y usos del suelo',
                     style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}}));
function makeRow(color, id, name) {
  return ui.Panel({widgets: [
    ui.Label({style: {backgroundColor: color, padding: '8px', margin: '0 2px 3px 0', border: '1px solid #999'}}),
    ui.Label({value: id + ' – ' + name, style: {margin: '0 0 3px 4px', fontSize: '11px'}})
  ], layout: ui.Panel.Layout.Flow('horizontal')});
}
var currentGroup = '';
legendData.forEach(function (r) {  
  if (r[2] !== currentGroup) {
    legend.add(ui.Label({value: r[2], style: {fontWeight: 'bold', fontSize: '11px', margin: '6px 0 2px 0', color: '#444'}}));
    currentGroup = r[2];
  }
  legend.add(makeRow(paletteArr[r[0]], r[0], r[1]));
});
Map.add(legend);

refreshLayers();

// # Export----
var OUT_FOLDER = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var OUT_NAME   = 'MEX_integration_alequech_natstable_v1';

// Reuse the source projection so the export matches the input grid exactly
var refInfo = asset.select(0).projection().getInfo();

Map.addLayer(table)

Export.image.toAsset({
  image: assetCorr,
  description: OUT_NAME,
  assetId: OUT_FOLDER + OUT_NAME,
  crs: refInfo.crs,
  crsTransform: refInfo.transform,
  region: assetCorr.geometry().bounds(),
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  overwrite: true
});
