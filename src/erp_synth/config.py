from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Config:
    seed: int = 42
    start: date = date(2025, 1, 1)
    end: date = date(2026, 10, 31)

    # Master data sizes
    n_customers: int = 400
    n_suppliers: int = 28
    n_products: int = 220
    n_employees: int = 60

    # Demand
    base_orders_per_day: float = 26.0
    annual_growth: float = 0.12
    cancel_rate: float = 0.015
    backorder_cancel_days: int = 30

    # Inventory policy
    safety_days: int = 7
    review_period_days: int = 7  # each supplier is ordered from on one fixed weekday
    order_cover_days: int = 21

    # Finance
    vat_rate: float = 0.07
    currency: str = "THB"
    opening_cash: float = 40_000_000.0
    share_capital: float = 50_000_000.0
    monthly_rent: float = 450_000.0
