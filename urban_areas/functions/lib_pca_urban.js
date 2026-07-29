// ============================================================
// lib_pca_urban.js
// Library to compute PC1 of urban indices in GEE
// Usage: var lib = require('users/YOUR_USER/YOUR_REPO:lib_pca_urban')
//        var mosaic_pc1 = lib.addPC1Urban(image, geometry)
// ============================================================

/**
 * Adds the PC1 of urban indices (NDBI, UI, NDUI, EBBI) as a band
 * to an input image.
 *
 * @param {ee.Image}    image    - Image with bands NDBI, UI, NDUI, EBBI
 * @param {ee.Geometry} geometry - Geometry used to compute the covariance
 * @returns {ee.Image} Original image with a 'PC1' band added
 */
exports.addPC1Urban = function(image, geometry) {
  var urban_bands = ['NDBI', 'UI', 'NDUI', 'EBBI'];

  // 1. Select the relevant bands
  var img_urban = image.select(urban_bands);

  // 2. Compute means and center the image
  var means = img_urban.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: geometry,
    scale: 30,
    maxPixels: 1e9,
    tileScale: 4
  });
  var centered = img_urban.subtract(means.toImage(urban_bands));

  // 3. Compute the covariance matrix
  var covMatrix = ee.Array(
    centered.toArray()
      .reduceRegion({
        reducer: ee.Reducer.covariance(),
        geometry: geometry,
        scale: 30,
        maxPixels: 1e9,
        tileScale: 4
      }).get('array')
  );

  // 4. Eigendecomposition → PC1
  var eigen   = covMatrix.eigen();
  var pc1_vec = eigen.slice(1, 1).slice(0, 0, 1); // shape [1x4]

  // 5. Project: multiply each centered band by its weight and sum
  var weights   = ee.Image.constant(pc1_vec.reshape([4]).toList())
                    .rename(urban_bands);
  var pc1_image = centered
                    .multiply(weights)
                    .reduce(ee.Reducer.sum())
                    .rename('PC_urban');

  return image.addBands(pc1_image);
};
