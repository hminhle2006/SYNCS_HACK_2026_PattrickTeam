"""Shared constants for Lane B.

If Lane A's CLAUDE.md eventually defines any of these, CLAUDE.md wins and this
file defers to it.
"""

# Sydney CBD: Circular Quay down to Central, Darling Harbour across to the
# Domain. Roughly 1.85 km east-west by 3.0 km north-south. Hyde Park sits
# inside it, which matters -- it is the one place tree canopy visibly drives
# the routing, and it makes the demo legible.
#
# Order is (west, south, east, north) == (left, bottom, right, top), which is
# what osmnx 2.x expects.
BBOX = (151.1990, -33.8840, 151.2190, -33.8570)

# Centroid, for solar position. The box is small enough that one position for
# the whole area is well inside the error the height data already carries.
CENTRE_LAT = -33.8705
CENTRE_LON = 151.2090

CRS_WGS84 = "EPSG:4326"
CRS_METRES = "EPSG:7856"

HOUR_START = 6
HOUR_END = 19
