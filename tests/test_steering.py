import unittest

from street_cleaner.agent.steering import recommend_steering


REGIONS = {"left_max": 0.33, "right_min": 0.67, "close_y": 0.75, "obstacle_y": 0.55}


def box(x, width, *, bottom=0.72, kind="obstacle", label="car"):
    return {"x": x, "y": bottom - 0.2, "w": width, "h": 0.2,
            "kind": kind, "label": label, "confidence": 0.9}


class SteeringTests(unittest.TestCase):
    def test_center_and_right_blocked_turn_left(self):
        guidance = recommend_steering([box(0.42, 0.40)], REGIONS)
        self.assertEqual(guidance["action"], "LEFT")
        self.assertEqual(guidance["blockedSectors"], ["center", "right"])

    def test_center_and_left_blocked_turn_right(self):
        guidance = recommend_steering([box(0.18, 0.40)], REGIONS)
        self.assertEqual(guidance["action"], "RIGHT")
        self.assertEqual(guidance["blockedSectors"], ["left", "center"])

    def test_near_person_or_no_open_sector_means_stop(self):
        for detections in ([box(0.44, 0.12, label="person")], [box(0.1, 0.8)]):
            with self.subTest(detections=detections):
                self.assertEqual(recommend_steering(detections, REGIONS)["action"], "STOP")

    def test_debris_in_an_open_lane_is_a_target(self):
        for x, bottom, expected in ((0.13, 0.6, "LEFT"), (0.75, 0.6, "RIGHT"),
                                    (0.45, 0.6, "FORWARD"), (0.45, 0.8, "CLEAN")):
            with self.subTest(x=x, bottom=bottom):
                target = box(x, 0.1, bottom=bottom, kind="debris", label="leaves")
                self.assertEqual(recommend_steering([target], REGIONS)["action"], expected)

    def test_obstacle_takes_priority_over_debris(self):
        target = box(0.15, 0.1, kind="debris", label="leaves")
        self.assertEqual(recommend_steering([target, box(0.1, 0.14)], REGIONS)["action"], "STOP")
        self.assertEqual(recommend_steering([target, box(0.1, 0.14, bottom=0.4)], REGIONS)["action"], "LEFT")

    def test_no_detections_means_hold_and_scan(self):
        self.assertEqual(recommend_steering([], REGIONS)["action"], "SCAN")
