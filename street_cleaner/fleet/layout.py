"""Which depot owns which robot, and which streets each robot cleans.

Street geometry comes from OpenStreetMap (run `python tools/fetch_streets.py`);
nothing here holds coordinates. Depot positions are derived from the streets.
"""

STATIONS = [
    {
        "id": "ST-W",
        "name": "Oxford Depot",
        "robots": {
            "SC-01": ["Coburg Road", "Larch Street", "Jennings Street", "Lilac Street"],
            "SC-02": ["Preston Street", "Walnut Street", "Chestnut Street"],
            "SC-03": ["Pepperell Street", "Shirley Street", "Jubilee Road", "Cambridge Street"],
        },
    },
    {
        "id": "ST-C",
        "name": "Studley Depot",
        "robots": {
            "SC-04": ["Henry Street", "LeMarchant Street", "Seymour Street"],
            "SC-05": ["Edward Street", "Vernon Street", "Bliss Street", "Carlton Street"],
            "SC-06": ["University Avenue", "South Street", "College Street"],
        },
    },
    {
        "id": "ST-E",
        "name": "South Park Depot",
        "robots": {
            "SC-07": ["South Park Street", "Brenton Street", "Morris Street", "Queen Street"],
            "SC-08": ["Wellington Street", "Tower Road", "Lucknow Street", "Victoria Road"],
            "SC-09": ["Spring Garden Road", "Summer Street"],
        },
    },
]

# Search window for the OSM query (south, west, north, east). Streets are clipped to it.
BBOX = (44.627, -63.600, 44.645, -63.570)

# Long streets cut down to the part that sits inside one robot's zone.
CLIP_LON = {"South Street": (-63.600, -63.585)}

# OSM road types that count as a cleanable street.
HIGHWAY_TYPES = {"primary", "secondary", "tertiary", "residential", "unclassified"}


def all_street_names():
    return [s for st in STATIONS for streets in st["robots"].values() for s in streets]
