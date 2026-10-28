# Deprecated Collection 1.0 pipeline

The scripts in this directory were part of the data flow used to produce MapBiomas Mexico Collection 1.0. They are deprecated and retained for historical reference and reproducibility.

This pipeline included the following steps:

1. `10.Integrate.js`: integration of regional classifications.
2. `11.GapFill.js`: integration of urban and mangrove themes and gap filling.
3. `12.Temporal`: temporal filtering.
4. `13.SpatialFilter.js`: spatial filtering.
5. `14.mode-weighted.js`: natural vegetation consolidation using a weighted mode.

These scripts should not be used for new Collection 1.1 processing.
