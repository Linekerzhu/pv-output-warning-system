"""Tests for curve-shape warning engine.

Detects M-shape oscillations and sudden drops in power_kw curves.
Threshold: power swing ≥ 40% of capacity in any 1-hour window.
Each area gets at most 1 warning per day.
"""

from datetime import date, timedelta

from app.core.config import settings
from app.models.warning_record import PowerPrediction
from app.services.warning import WarningService

CAP = 10000  # 10 MW test capacity
PR = settings.PV_PERFORMANCE_RATIO  # 0.80


def make_pred(hour: int, ghi: float, clearsky_ghi: float = 800,
              capacity_kw: float = CAP, text: str = "晴",
              target_date: str | None = None) -> PowerPrediction:
    d = target_date or str(date.today() + timedelta(days=1))
    wr = ghi / clearsky_ghi if clearsky_ghi > 0 else 0
    return PowerPrediction(
        time=f"{d} {hour:02d}:00",
        ghi=ghi, clearsky_ghi=clearsky_ghi,
        weather_ratio=round(wr, 4),
        power_kw=round(capacity_kw * ghi / 1000 * PR, 2),
        clearsky_power_kw=round(capacity_kw * clearsky_ghi / 1000 * PR, 2),
        weather_text=text, weather_icon=100, is_estimated=False,
    )


class TestFindSwings:
    def setup_method(self):
        self.svc = WarningService()

    def test_no_swing_smooth_curve(self):
        """正常晴天钟形曲线，相邻小时变化远小于40%"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(9, 300, target_date=tomorrow),
            make_pred(10, 500, target_date=tomorrow),
            make_pred(11, 700, target_date=tomorrow),
            make_pred(12, 800, target_date=tomorrow),
            make_pred(13, 750, target_date=tomorrow),
            make_pred(14, 600, target_date=tomorrow),
            make_pred(15, 400, target_date=tomorrow),
            make_pred(16, 150, target_date=tomorrow),
        ]
        swings = self.svc._find_swings(preds, CAP)
        assert len(swings) == 0

    def test_sudden_drop(self):
        """晴→暴雨: GHI 800→100, power 6.4MW→0.8MW, swing=5.6MW=70%"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(12, 800, target_date=tomorrow),
            make_pred(13, 100, text="暴雨", target_date=tomorrow),
        ]
        swings = self.svc._find_swings(preds, CAP)
        assert len(swings) == 1
        assert swings[0].direction == "ramp_down"
        assert swings[0].swing_ratio >= 0.40

    def test_m_shape(self):
        """M形: 晴→暴雨→晴→暴雨"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(10, 700, target_date=tomorrow),   # 晴
            make_pred(11, 100, target_date=tomorrow),   # 暴雨
            make_pred(12, 750, target_date=tomorrow),   # 晴
            make_pred(13, 80, target_date=tomorrow),    # 暴雨
        ]
        swings = self.svc._find_swings(preds, CAP)
        assert len(swings) >= 3  # down, up, down


class TestEvaluatePredictions:
    def setup_method(self):
        self.svc = WarningService()

    def test_clear_day_no_warning(self):
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [make_pred(h, ghi=g, target_date=tomorrow)
                 for h, g in [(9,300),(10,500),(11,700),(12,800),(13,750),(14,600),(15,400),(16,150)]]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 0

    def test_overcast_day_no_warning(self):
        """全天阴: 低但稳定"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [make_pred(h, ghi=g, text="阴", target_date=tomorrow)
                 for h, g in [(9,80),(10,150),(11,200),(12,220),(13,200),(14,170),(15,120),(16,50)]]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 0

    def test_sudden_storm_triggers(self):
        """晴天12:00突然暴雨，持续到傍晚"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(9, 300, target_date=tomorrow),
            make_pred(10, 500, target_date=tomorrow),
            make_pred(11, 700, target_date=tomorrow),
            make_pred(12, 800, text="晴", target_date=tomorrow),
            make_pred(13, 100, text="暴雨", target_date=tomorrow),
            make_pred(14, 80, text="大雨", target_date=tomorrow),
            make_pred(15, 60, text="中雨", target_date=tomorrow),
            make_pred(16, 40, text="小雨", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 1
        assert warnings[0].type == "ramp_down"

    def test_m_shape_triggers_oscillation(self):
        """M形: 晴→暴雨→晴→暴雨"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(9, 300, target_date=tomorrow),
            make_pred(10, 700, text="晴", target_date=tomorrow),
            make_pred(11, 100, text="暴雨", target_date=tomorrow),
            make_pred(12, 750, text="晴", target_date=tomorrow),
            make_pred(13, 80, text="暴雨", target_date=tomorrow),
            make_pred(14, 60, text="大雨", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 1
        assert warnings[0].type == "oscillation"

    def test_one_warning_per_day(self):
        """同一天多次骤变只产生1条预警"""
        tomorrow = str(date.today() + timedelta(days=1))
        preds = [
            make_pred(10, 700, target_date=tomorrow),
            make_pred(11, 50, target_date=tomorrow),
            make_pred(12, 700, target_date=tomorrow),
            make_pred(13, 50, target_date=tomorrow),
            make_pred(14, 700, target_date=tomorrow),
            make_pred(15, 50, target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 1  # not 5

    def test_gradual_clouding_no_warning(self):
        """缓慢变阴: 每小时降幅<40%装机容量"""
        tomorrow = str(date.today() + timedelta(days=1))
        # power drops: 6.4→5.2→4.0→3.2→2.4→1.6→0.8→0.4 MW
        # each step ~1.2MW = 12% of 10MW, well below 40%
        preds = [make_pred(h, ghi=g, target_date=tomorrow)
                 for h, g in [(9,800),(10,650),(11,500),(12,400),(13,300),(14,200),(15,100),(16,50)]]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 0

    def test_cross_day_separate(self):
        """两天的数据，各自独立分析"""
        today = str(date.today() + timedelta(days=1))
        tomorrow = str(date.today() + timedelta(days=2))
        preds = [
            make_pred(12, 800, target_date=today),
            make_pred(13, 100, target_date=today),     # day1: storm
            make_pred(12, 800, target_date=tomorrow),
            make_pred(13, 100, target_date=tomorrow),  # day2: storm
        ]
        warnings = self.svc.evaluate_predictions("石化街道", preds, CAP, is_historical=True)
        assert len(warnings) == 2  # one per day
