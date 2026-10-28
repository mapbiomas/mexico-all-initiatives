// DEPRECATED: Part of the MapBiomas Mexico Collection 1.0 data flow; retained for historical reference.
// Versión script 20/07/2026
// Cross-cutting themes integration (Urban + Mangrove) + Gapfill
// National product MapBiomas México - Collection 1

// Description:
// Overlays the urban (24) and mangrove (5) cross-cutting layers on the base
// LULC classification following a per-pixel/per-year hierarchy, applies a valid
// class filter, and runs a forward + backward temporal gapfill on the result.

// Per-pixel/year hierarchy:  base LULC  <  Urban (24)  <  Mangrove (5)
//   Rule 1: urban overwrites any land cover class.
//   Rule 2: mangrove overwrites any land cover AND urban.

// Inputs:
//   Base:     MEX_integration_alequech_v1_raw
//   Urban:    urban_temporal_filter4_1985_2025_v1   (class 24)
//   Mangrove: MEX_mangrove_only_v2                  (input value 1 -> reassigned to 5)

// Note:
// The probability branch is disabled in this run (see commented block at end).

var auxFuncs = require('users/JonathanVSV/Mapbiomas_reg4:0.aux');

// # User variables----
var country_name = 'MEX';

// ## Input paths
var BASE_PATH     = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/MEX_integration_alequech_v1_raw';
var URBAN_PATH    = 'projects/mapbiomas-mexico/assets/Urban/COLLECTION-1/classification-ft/urban_temporal_filter4_1985_2025_v1';
var MANGROVE_PATH = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/mangrove/MEX_mangrove_only_v2';

// ## Output path / name  (<-- CONFIRM name)
var class_folder_out  = 'projects/mapbiomas-mexico/assets/LAND-COVER/COLLECTION-1/GENERAL/classification-ft/';
var gap_file_name_out = country_name + '_integration_alequech_gapfill_v1';

// ## Band prefixes  (<-- VERIFY in console; adjust if they differ)
var BASE_PREFIX     = 'classification_';
var URBAN_PREFIX    = 'classification_';
var MANGROVE_PREFIX = 'mangrove_';

// ## Output class values (hierarchy)
var URBAN_VALUE_OUT    = 24;   // Urban and built-up area
var MANGROVE_VALUE_OUT = 5;    // Mangrove (input layer carries value 1)

// ## Years (1985-2025)
var years = [1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001,
             2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018,
             2019, 2020, 2021, 2022, 2023, 2024, 2025];
var yearInterest = 2025;

var bandNames = ee.List(years.map(function (year) {
    return 'classification_' + String(year);
}));

// ## Visualization
var vis = {min: 0, max: 89, palette: auxFuncs.paleta};

// Do not need to move anything else from here on -----

// # Read assets----
var baseImg     = ee.Image(BASE_PATH);
var urbanImg    = ee.Image(URBAN_PATH);
var mangroveImg = ee.Image(MANGROVE_PATH);

// DIAGNOSTIC: check band names before exporting
print('BASE bandNames',     baseImg.bandNames());
print('URBAN bandNames',    urbanImg.bandNames());
print('MANGROVE bandNames', mangroveImg.bandNames());

// # Cross-cutting integration----
// Build the integrated classification applying the hierarchy year by year.
var integrated = ee.ImageCollection.fromImages(
    years.map(function (year) {
        var base = baseImg.select(BASE_PREFIX + String(year));
        var urb  = urbanImg.select(URBAN_PREFIX + String(year)).unmask(0);
        var mang = mangroveImg.select(MANGROVE_PREFIX + String(year)).unmask(0);

        // Remove residual urban(24)/mangrove(5) from the base -> NULL.
        // These classes come EXCLUSIVELY from the cross-cutting layers;
        // the resulting holes are filled later in the gapfill.
        base = base.updateMask(base.neq(URBAN_VALUE_OUT).and(base.neq(MANGROVE_VALUE_OUT)));

        // "Present" = pixel with a non-zero value (robust to encoding 1 or 24)
        var urbPresent  = urb.neq(0);
        var mangPresent = mang.neq(0);

        return base
            .where(urbPresent,  URBAN_VALUE_OUT)     // Rule 1: urban over land cover
            .where(mangPresent, MANGROVE_VALUE_OUT)  // Rule 2: mangrove over land cover and urban
            .rename('classification_' + String(year));
    })
).toBands().rename(bandNames);

// # Validity filter (post-integration)----
// Any value outside the valid class list becomes NULL.
//  Forests: 88, 89, 3 | Mangrove: 5 | Shrubland: 66 | Natural savanna/grassland: 45
//  Flooded: 11 | Cultivated pasture: 15 | Perennial crop: 36 | Annual crop: 19
//  Forest plantation: 9 | Mosaic of uses: 21 | Urban: 24 | Bare: 25
//  River/lake/sea: 33 | Glacier: 34
var validClasses = [3, 5, 9, 11, 15, 19, 21, 24, 25, 33, 34, 36, 45, 66, 88, 89];

var integratedRaw = integrated;   // unfiltered copy (for diagnostics)
var validMask = integratedRaw.eq(validClasses[0]);
for (var vi = 1; vi < validClasses.length; vi++) {
    validMask = validMask.or(integratedRaw.eq(validClasses[vi]));
}
integrated = integratedRaw.updateMask(validMask);

print('Integrated classification (cross-cutting + validity filter)', integrated);

// # Hierarchy rules demo----
// "Source" map for the year of interest:
//   0 = base class kept | 1 = urban applied | 2 = mangrove applied
var baseY = baseImg.select(BASE_PREFIX + String(yearInterest)).unmask(0);
var urbY  = urbanImg.select(URBAN_PREFIX + String(yearInterest)).unmask(0).neq(0);
var mangY = mangroveImg.select(MANGROVE_PREFIX + String(yearInterest)).unmask(0).neq(0);

var fuente = ee.Image(0)
    .where(urbY,  1)
    .where(mangY, 2)                      // mangrove (2) wins over urban (1)
    .rename('fuente')
    .updateMask(baseY.neq(0).or(urbY).or(mangY));
var fuenteVis = {min: 0, max: 2, palette: ['#BDBDBD', '#d63000', '#FF12A8']}; // grey/red/pink

Map.addLayer(fuente, fuenteVis, 'Fuente jerarquía ' + yearInterest, false);
Map.addLayer(urbY.and(mangY).selfMask(),  {palette: ['#FF12A8']}, 'Manglar SOBRE urbano ' + yearInterest, false);
Map.addLayer(urbY.selfMask(),             {palette: ['#d63000']}, 'Urbano aplicado ' + yearInterest, false);
Map.addLayer(mangY.selfMask(),            {palette: ['#FF12A8']}, 'Manglar aplicado ' + yearInterest, false);

// Base pixels with own 24/5 removed (become NULL before gapfill)
var baseResidual = baseImg.select(BASE_PREFIX + String(yearInterest));
baseResidual = baseResidual.eq(URBAN_VALUE_OUT).or(baseResidual.eq(MANGROVE_VALUE_OUT));
Map.addLayer(baseResidual.selfMask(), {palette: ['#000000']}, 'Base 24/5 residual -> NULL ' + yearInterest, false);

// Values outside the valid class list that become NULL (year of interest)
var invalidMaskY = validMask.select('classification_' + String(yearInterest)).not();
Map.addLayer(integratedRaw.select('classification_' + String(yearInterest)).updateMask(invalidMaskY),
    vis, 'Valores inválidos -> NULL ' + yearInterest, false);

// # Gapfill----
// (classification only; no probabilities in this run)
var classification = integrated;

var years_index = ee.List.sequence(0, years.length - 1);

// Fill the current year's masked pixels with the previous filled year
var gap_fill = function (current_year_index, obj) {
    obj = ee.Dictionary(obj);
    var previous_year_index = ee.Number(current_year_index).subtract(1);
    var image_filled = ee.Image(obj.get('image_filled'));
    var image_base = ee.Image(obj.get('image_base'));
    var current_image = image_base.select([ee.Number(current_year_index)]);
    var previous_image_filled = image_filled.select([previous_year_index]);
    var current_filled = current_image.unmask(previous_image_filled);
    obj = obj.set('image_filled', image_filled.addBands(current_filled));
    return obj;
};

// Forward fill: propagate values from past to future
var forward_fill = function (image) {
    var first = image.select([0]);
    var result = years_index.slice(1).iterate(gap_fill, {
        image_filled: first,
        image_base: image
    });
    return ee.Image(ee.Dictionary(result).get('image_filled'));
};

// Backward fill: reverse band order, fill, then restore original order
var backward_fill = function (image) {
    image = image.select(years_index.reverse());
    var last = image.select([0]);
    var result = years_index.slice(1).iterate(gap_fill, {
        image_filled: last,
        image_base: image
    });
    return ee.Image(ee.Dictionary(result).get('image_filled')).select(years_index.reverse());
};

var forward_filled = forward_fill(classification.selfMask());
var fully_filled = backward_fill(forward_filled);

var image = fully_filled;

var bandsOccurrence = ee.Dictionary(
    bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

// Classification: byte is correct (categorical values 0-89)
var bandsDictionary = bandsOccurrence.map(function (key, value) {
    return ee.Image(
        ee.Algorithms.If(
            ee.Number(value).eq(2),
            image.select([key]).byte(),
            ee.Image().rename([key]).byte().updateMask(image.select(0))
        )
    );
});

var imageAllBands = ee.Image(
    bandNames.iterate(function (band, image) {
        return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
    }, ee.Image().select())
);

var imagePixelYear = ee.Image.constant(years)
    .updateMask(imageAllBands)
    .rename(bandNames);

// connectedPixelCount over imageAllBands (spatial context bands)
var imageFilledConnected = imageAllBands.addBands(
    imageAllBands
        .connectedPixelCount(100, true)
        .rename(bandNames.map(function (band) {
            return ee.String(band).cat('_conn');
        }))
);

print('output classification', imageFilledConnected);

// # Export----
Export.image.toAsset({
    image: imageFilledConnected,
    description: gap_file_name_out,
    assetId: class_folder_out + gap_file_name_out,
    pyramidingPolicy: {'.default': 'mode'},
    region: imageFilledConnected.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite: true
});

// # Visualization----
Map.addLayer(baseImg.select('classification_' + yearInterest), vis,
    'Base (raw) ' + yearInterest, false);
Map.addLayer(integrated.select('classification_' + yearInterest), vis,
    'Integrada transversal ' + yearInterest, true);
Map.addLayer(imageFilledConnected.select('classification_' + yearInterest), vis,
    'Gapfilled ' + yearInterest, false);

// =====================================================================
//  PROBABILITY (disabled in this run)
//  Kept for reference: mirrors the classification pipeline but keeps
//  probability bands as float and exports with 'mean' pyramiding.

/*
// FIX Bug 1: probability must stay float, NOT byte
var bandsDictionaryProb = bandsOccurrenceProb.map(function (key, value) {
    return ee.Image(
        ee.Algorithms.If(
            ee.Number(value).eq(2),
            imageProb.select([key]).toFloat(),
            ee.Image().rename([key]).toFloat().updateMask(imageProb.select(0))
        )
    );
});
var imageAllBands = ee.Image(
    bandNames.iterate(function (band, image) {
        return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
    }, ee.Image().select())
);
var imageAllBandsProb = ee.Image(
    bandNamesProb.iterate(function (band, image) {
        return ee.Image(image).addBands(bandsDictionaryProb.get(ee.String(band)));
    }, ee.Image().select())
);
var imagePixelYear = ee.Image.constant(years)
    .updateMask(imageAllBands)
    .rename(bandNames);
var imagePixelYearProb = ee.Image.constant(years)
    .updateMask(imageAllBandsProb)
    .rename(bandNamesProb);
// Classification: connectedPixelCount over imageAllBands
var imageFilledConnected = imageAllBands.addBands(
    imageAllBands
        .connectedPixelCount(100, true)
        .rename(bandNames.map(function (band) {
            return ee.String(band).cat('_conn');
        }))
);
// FIX Bug 2: use imageAllBandsProb (not imageProb) for the probability export
var imageFilledConnectedProb = imageAllBandsProb.addBands(
    imageFilledConnected.select('.*_conn')
);
print('output classification', imageFilledConnected);
print('output probability', imageFilledConnectedProb);
Export.image.toAsset({
    image: imageFilledConnected,
    description: gap_file_name_out,
    assetId: class_folder_out + gap_file_name_out,
    pyramidingPolicy: {'.default': 'mode'},
    region: imageFilledConnected.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite: true
});
Export.image.toAsset({
    image: imageFilledConnectedProb,
    description: gap_prob_file_name_out,
    assetId: class_folder_out + gap_prob_file_name_out,
    pyramidingPolicy: {'.default': 'mean'},
    region: imageFilledConnectedProb.geometry().bounds(),
    scale: 30,
    maxPixels: 1e13,
    overwrite: true
});

*/
// =====================================================================
